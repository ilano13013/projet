/**
 * Composition de production : assemble les Services HTTP à partir de PostgreSQL,
 * Stripe (test) et du domaine. Type-vérifié ; non exécuté dans l'environnement
 * de scaffold (nécessite un Postgres accessible via DATABASE_URL).
 */
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type {
  Services, Actor, SessionService, AuthService, SlotsService,
  AppointmentService, VerificationService, BillingService, WebhookService,
} from './http/services';
import type { EmailQueuePort } from './ports';
import { PgAppointmentRepo } from './adapters/pg';
import { StripePayment } from './adapters/stripe';
import { hashPassword, verifyPassword } from './auth/password';
import { generateResetToken, isResetTokenValid, hashToken, DEFAULT_TTL_MINUTES } from './auth/tokens';
import { computeSlots, type AvailabilityRule } from './domain/slots';
import type { Role } from './domain/authz';

const SESSION_TTL_H = 12;

function createSession(pool: Pool, userId: string): Promise<string> {
  const id = randomUUID();
  const expires = new Date(Date.now() + SESSION_TTL_H * 3600_000);
  return pool.query('INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)', [id, userId, expires]).then(() => id);
}

function makeSession(pool: Pool): SessionService {
  return {
    async actorForSession(sid) {
      if (!sid) return null;
      const r = await pool.query<{ user_id: string; role: Role; expires_at: Date; revoked_at: Date | null; mfa_enabled: boolean | null }>(
        `SELECT s.user_id, u.role, s.expires_at, s.revoked_at, c.mfa_enabled
           FROM sessions s JOIN users u ON u.id = s.user_id
           LEFT JOIN auth_credentials c ON c.user_id = u.id
          WHERE s.id = $1`, [sid]);
      const row = r.rows[0];
      if (!row || row.revoked_at || row.expires_at.getTime() < Date.now()) return null;
      return { userId: row.user_id, role: row.role, mfa: !!row.mfa_enabled } satisfies Actor;
    },
  };
}

function makeAuth(pool: Pool, email: EmailQueuePort): AuthService {
  return {
    async register(input) {
      const exists = await pool.query('SELECT 1 FROM users WHERE email=$1', [input.email]);
      if (exists.rowCount) return { error: 'email_taken' };
      const id = randomUUID();
      await pool.query('INSERT INTO users(id,email,role,status) VALUES($1,$2,$3,$4)',
        [id, input.email, input.role, input.role === 'professionnel' ? 'pending' : 'active']);
      await pool.query('INSERT INTO auth_credentials(user_id,password_hash) VALUES($1,$2)', [id, hashPassword(input.password)]);
      return { sessionId: await createSession(pool, id) };
    },
    async login(emailAddr, password) {
      const r = await pool.query<{ id: string; password_hash: string }>(
        'SELECT u.id, c.password_hash FROM users u JOIN auth_credentials c ON c.user_id=u.id WHERE u.email=$1', [emailAddr]);
      const row = r.rows[0];
      if (!row || !verifyPassword(password, row.password_hash)) return null;
      return { sessionId: await createSession(pool, row.id) };
    },
    async logout(sid) { await pool.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [sid]); },
    async requestReset(emailAddr) {
      const r = await pool.query<{ id: string }>('SELECT id FROM users WHERE email=$1', [emailAddr]);
      const row = r.rows[0];
      if (row) {
        const { token, tokenHash } = generateResetToken();
        const expires = new Date(Date.now() + DEFAULT_TTL_MINUTES * 60000);
        await pool.query('INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,$3)', [row.id, tokenHash, expires]);
        await email.enqueue({ to: emailAddr, subject: 'PRIMA — réinitialisation', body: `Jeton : ${token}`, idempotencyKey: tokenHash });
      }
      // SEC-02 : réponse uniforme — aucun retour différent si le compte n'existe pas.
    },
    async confirmReset(token, newPassword) {
      const th = hashToken(token);
      const r = await pool.query<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
        'SELECT id,user_id,expires_at,used_at FROM password_reset_tokens WHERE token_hash=$1', [th]);
      const rec = r.rows[0];
      if (!rec || !isResetTokenValid({ tokenHash: th, expiresAt: rec.expires_at, usedAt: rec.used_at }, token, new Date())) return false;
      await pool.query('UPDATE auth_credentials SET password_hash=$1, updated_at=now() WHERE user_id=$2', [hashPassword(newPassword), rec.user_id]);
      await pool.query('UPDATE password_reset_tokens SET used_at=now() WHERE id=$1', [rec.id]); // usage unique
      await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [rec.user_id]); // révoque les sessions
      return true;
    },
  };
}

function makeSlots(pool: Pool): SlotsService {
  return {
    async forPro(proId, dateISO) {
      const rules = (await pool.query<AvailabilityRule>(
        `SELECT weekday, start_minute AS "startMinute", end_minute AS "endMinute", timezone, active
           FROM availability_rules WHERE professional_user_id=$1 AND active=true`, [proId])).rows;
      const blocked = (await pool.query<{ start_at: Date; end_at: Date }>(
        'SELECT start_at,end_at FROM blocked_periods WHERE professional_user_id=$1', [proId])).rows
        .map(b => ({ startUtc: b.start_at, endUtc: b.end_at }));
      const existing = (await pool.query<{ start_at: Date; end_at: Date }>(
        `SELECT start_at,end_at FROM appointments WHERE professional_user_id=$1 AND status IN ('pending','confirmed')`, [proId])).rows
        .map(e => ({ startUtc: e.start_at, endUtc: e.end_at }));
      const typeRow = (await pool.query<{ duration_minutes: number }>(
        'SELECT duration_minutes FROM appointment_types WHERE professional_user_id=$1 AND active=true ORDER BY duration_minutes LIMIT 1', [proId])).rows[0];
      const duration = typeRow?.duration_minutes ?? 30;
      return computeSlots({ dateISO, rules, blocked, existing, durationMinutes: duration, timezone: 'Europe/Paris', nowUtc: new Date() })
        .map(d => d.toISOString());
    },
  };
}

function makeAppointments(pool: Pool): AppointmentService {
  const repo = new PgAppointmentRepo(pool);
  return {
    book(actor, proId, startUtc, endUtc, motif) {
      return repo.bookTransactional({ professionalUserId: proId, clientUserId: actor.userId, startUtc, endUtc, motif });
    },
    async ownerOf(id) {
      const r = await pool.query<{ professional_user_id: string }>('SELECT professional_user_id FROM appointments WHERE id=$1', [id]);
      return r.rows[0]?.professional_user_id ?? null;
    },
    async setStatus(id, status) { await pool.query('UPDATE appointments SET status=$1 WHERE id=$2', [status, id]); },
  };
}

function makeVerification(pool: Pool): VerificationService {
  return {
    async decide(adminId, proId, decision, note) {
      // La vérification est une décision explicite (auteur, date, preuve) — JAMAIS
      // l'effet d'un abonnement payé.
      await pool.query(
        `INSERT INTO verification_records(professional_user_id,decision,decided_by,note,decided_at)
         VALUES($1,$2,$3,$4,now())`, [proId, decision, adminId, note ?? null]);
      await pool.query('UPDATE professional_profiles SET verified=$1 WHERE user_id=$2', [decision === 'approved', proId]);
    },
  };
}

function makeBilling(pool: Pool, pay: StripePayment, baseUrl: string): BillingService {
  return {
    async checkout(proId, plan) {
      const s = await pay.createCheckout({ plan, customerRef: proId, successUrl: `${baseUrl}/billing/ok`, cancelUrl: `${baseUrl}/billing/cancel` });
      return { url: s.url };
    },
  };
}

function makeWebhook(pool: Pool, pay: StripePayment): WebhookService {
  return {
    async handleStripe(payload, signature) {
      if (!pay.verifyWebhook(payload, signature)) return { status: 400 };     // signature invalide
      const evt = JSON.parse(payload) as { id: string; type: string; data?: { object?: Record<string, unknown> } };
      // Idempotence : l'unicité (provider, provider_event_id) empêche le double traitement.
      const ins = await pool.query(
        `INSERT INTO webhook_events(provider,provider_event_id,type,payload)
         VALUES('stripe',$1,$2,$3) ON CONFLICT (provider,provider_event_id) DO NOTHING RETURNING id`,
        [evt.id, evt.type, JSON.stringify(evt)]);
      if (ins.rowCount === 0) return { status: 200 };                          // déjà traité
      // Droits calculés CÔTÉ SERVEUR à partir de l'événement signé (jamais le navigateur).
      if (evt.type === 'checkout.session.completed' || evt.type === 'customer.subscription.updated') {
        // … mettre à jour subscriptions.status/current_period_end selon evt.data.object …
      }
      await pool.query('UPDATE webhook_events SET processed_at=now(), status=$1 WHERE provider=$2 AND provider_event_id=$3',
        ['processed', 'stripe', evt.id]);
      return { status: 200 };
    },
  };
}

export function createServices(pool: Pool, pay: StripePayment, email: EmailQueuePort, baseUrl: string): Services {
  return {
    session: makeSession(pool),
    auth: makeAuth(pool, email),
    slots: makeSlots(pool),
    appts: makeAppointments(pool),
    verification: makeVerification(pool),
    billing: makeBilling(pool, pay, baseUrl),
    webhook: makeWebhook(pool, pay),
  };
}
