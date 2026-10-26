/**
 * Application HTTP (Fastify). Ordre des contrôles = REFUS PAR DÉFAUT :
 *   1. session (cookie HttpOnly/Secure/SameSite) → acteur serveur, jamais localStorage
 *   2. CSRF (double-submit) sur les requêtes mutantes authentifiées
 *   3. autorisation `can()` (domaine) sur chaque action, par identifiant de ressource
 *   4. validation d'entrée (zod)
 * Le webhook Stripe est exempt de session/CSRF : il est authentifié par la
 * SIGNATURE et rendu idempotent côté service.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { z } from 'zod';
import { can } from '../domain/authz';
import type { Services, Actor } from './services';
import { registerLot3Routes } from './lot3';

declare module 'fastify' {
  interface FastifyRequest { actor: Actor | null; rawBody?: string; }
}

const COOKIE_BASE = { httpOnly: true, sameSite: 'lax' as const, secure: true, path: '/' };

export function buildApp(services: Services, opts: { cookieSecure?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const cookieOpts = { ...COOKIE_BASE, secure: opts.cookieSecure ?? true };

  app.register(cookie);
  // Conserve le corps brut (signature webhook) tout en parsant le JSON.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as FastifyRequest).rawBody = body as string;
    if (!body) return done(null, {});
    try { done(null, JSON.parse(body as string)); } catch (e) { done(e as Error, undefined); }
  });

  // 1-2. Session + CSRF
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    req.actor = await services.session.actorForSession(req.cookies?.sid);
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const isWebhook = req.url.startsWith('/webhooks/');
    if (mutating && req.actor && !isWebhook) {
      const header = req.headers['x-csrf-token'];
      const cookieTok = req.cookies?.csrf;
      if (!header || !cookieTok || header !== cookieTok) {
        return reply.code(403).send({ error: 'csrf' });
      }
    }
  });

  function requireActor(req: FastifyRequest, reply: FastifyReply): Actor | null {
    if (!req.actor) { reply.code(401).send({ error: 'unauthenticated' }); return null; }
    return req.actor;
  }
  function setSession(reply: FastifyReply, sid: string) {
    const csrf = Math.random().toString(36).slice(2) + Date.now().toString(36);
    reply.setCookie('sid', sid, cookieOpts);
    reply.setCookie('csrf', csrf, { ...cookieOpts, httpOnly: false }); // lisible par le client pour le double-submit
  }

  // ── Public ──
  app.get('/health', async () => ({ ok: true }));
  app.get('/me', async (req, reply) => {
    const a = requireActor(req, reply); if (!a) return;
    return { userId: a.userId, role: a.role };
  });

  // ── Auth ──
  const regSchema = z.object({ email: z.string().email(), password: z.string().min(12), role: z.enum(['particulier', 'professionnel']) });
  app.post('/auth/register', async (req, reply) => {
    const p = regSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid' });
    const r = await services.auth.register(p.data);
    if ('error' in r) return reply.code(409).send({ error: r.error });
    setSession(reply, r.sessionId);
    return reply.code(201).send({ ok: true });
  });

  const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
  app.post('/auth/login', async (req, reply) => {
    const p = loginSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid' });
    const r = await services.auth.login(p.data.email, p.data.password);
    if (!r) return reply.code(401).send({ error: 'invalid_credentials' });
    setSession(reply, r.sessionId);
    return { ok: true };
  });

  app.post('/auth/logout', async (req, reply) => {
    const a = requireActor(req, reply); if (!a) return;
    await services.auth.logout(req.cookies?.sid as string);
    reply.clearCookie('sid', cookieOpts); reply.clearCookie('csrf', { ...cookieOpts, httpOnly: false });
    return { ok: true };
  });

  app.post('/auth/reset/request', async (req, reply) => {
    const p = z.object({ email: z.string().email() }).safeParse(req.body);
    if (p.success) await services.auth.requestReset(p.data.email);
    // SEC-02 : réponse UNIFORME quelle que soit l'existence du compte.
    return reply.code(202).send({ ok: true });
  });

  app.post('/auth/reset/confirm', async (req, reply) => {
    const p = z.object({ token: z.string().min(10), password: z.string().min(12) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid' });
    const ok = await services.auth.confirmReset(p.data.token, p.data.password);
    return reply.code(ok ? 200 : 400).send({ ok });
  });

  // ── Créneaux & RDV ──
  app.get('/pros/:id/slots', async (req, reply) => {
    const a = requireActor(req, reply); if (!a) return;
    const id = (req.params as { id: string }).id;
    const date = (req.query as { date?: string }).date || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: 'date' });
    return { slots: await services.slots.forPro(id, date) };
  });

  const bookSchema = z.object({ proId: z.string().min(1), startUtc: z.string().datetime(), endUtc: z.string().datetime(), motif: z.string().optional() });
  app.post('/appointments', async (req, reply) => {
    const a = requireActor(req, reply); if (!a) return;
    const p = bookSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid' });
    const r = await services.appts.book(a, p.data.proId, new Date(p.data.startUtc), new Date(p.data.endUtc), p.data.motif);
    if (!r.ok) return reply.code(r.reason === 'slot_taken' ? 409 : 400).send({ error: r.reason });
    return reply.code(201).send({ appointmentId: r.appointmentId });
  });

  async function changeStatus(req: FastifyRequest, reply: FastifyReply, status: 'confirmed' | 'cancelled') {
    const a = requireActor(req, reply); if (!a) return;
    const id = (req.params as { id: string }).id;
    const ownerProId = await services.appts.ownerOf(id);
    if (!ownerProId) return reply.code(404).send({ error: 'not_found' });
    if (!can(a, 'appointment:write', { ownerProId })) return reply.code(403).send({ error: 'forbidden' });
    await services.appts.setStatus(id, status);
    return { ok: true };
  }
  app.post('/appointments/:id/confirm', (req, reply) => changeStatus(req, reply, 'confirmed'));
  app.post('/appointments/:id/cancel', (req, reply) => changeStatus(req, reply, 'cancelled'));

  // ── Admin : vérification (MFA requis ; l'abonnement ne confère pas le statut) ──
  app.post('/admin/verify', async (req, reply) => {
    const a = requireActor(req, reply); if (!a) return;
    if (!can(a, 'verification:decide')) return reply.code(403).send({ error: 'forbidden' });
    if (!a.mfa) return reply.code(403).send({ error: 'mfa_required' });
    const p = z.object({ proId: z.string().min(1), decision: z.enum(['approved', 'rejected']), note: z.string().optional() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid' });
    await services.verification.decide(a.userId, p.data.proId, p.data.decision, p.data.note);
    return { ok: true };
  });

  // ── Abonnement SaaS (Stripe test) ──
  app.post('/billing/checkout', async (req, reply) => {
    const a = requireActor(req, reply); if (!a) return;
    if (a.role !== 'professionnel') return reply.code(403).send({ error: 'forbidden' });
    const p = z.object({ plan: z.enum(['premium', 'expert']) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid' });
    return await services.billing.checkout(a.userId, p.data.plan);
  });

  // ── Webhook Stripe : signature + idempotence (jamais le retour navigateur) ──
  app.post('/webhooks/stripe', async (req, reply) => {
    const sig = req.headers['stripe-signature'];
    const r = await services.webhook.handleStripe(req.rawBody ?? '', typeof sig === 'string' ? sig : '');
    return reply.code(r.status).send({ received: r.status < 400 });
  });

  if (services.lot3) registerLot3Routes(app, services.lot3, requireActor);

  return app;
}
