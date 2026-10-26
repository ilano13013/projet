/**
 * Adaptateurs PostgreSQL du Lot 3 (production). Type-vérifiés ; exécution
 * réelle sur une base appliquant migrations/001 + 002.
 */
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type {
  InvoiceRepoPort, SubscriptionRepoPort, DraftResult, IssueResult, InvoiceOpResult,
  FileStoragePort, EmailQueuePort,
} from '../ports';
import { isValidAmountCents, nextInvoiceNumber, canDelete, canTransition, type InvoiceStatus } from '../domain/invoicing';
import type { SubState } from '../domain/entitlements';
import { notificationEmail, type CaseCtx, type CaseMessage } from '../domain/messaging';
import { DEFAULT_QUOTA_BYTES } from '../domain/documents';
import type { Lot3Services } from '../http/lot3';

type Db = Pool | PoolClient;

async function inTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}

export class PgInvoiceRepo implements InvoiceRepoPort {
  constructor(private pool: Pool) {}

  async createDraft(i: { professionalUserId: string; clientUserId?: string; caseId?: string; amountCents: number; service?: string }): Promise<DraftResult> {
    if (!isValidAmountCents(i.amountCents)) return { ok: false, reason: 'invalid_amount' };
    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO invoices(professional_user_id,client_user_id,case_id,status,amount_cents,service)
       VALUES($1,$2,$3,'draft',$4,$5) RETURNING id`,
      [i.professionalUserId, i.clientUserId ?? null, i.caseId ?? null, i.amountCents, i.service ?? null]);
    return { ok: true, id: r.rows[0].id };
  }

  issue(invoiceId: string, proId: string, year: number): Promise<IssueResult> {
    return inTx(this.pool, async (c): Promise<IssueResult> => {
      const row = (await c.query<{ status: InvoiceStatus }>(
        'SELECT status FROM invoices WHERE id=$1 AND professional_user_id=$2 FOR UPDATE', [invoiceId, proId])).rows[0];
      if (!row) return { ok: false, reason: 'not_found' };
      if (row.status !== 'draft') return { ok: false, reason: 'not_draft' };
      // Verrou de ligne sur le compteur : deux émissions concurrentes sont sérialisées.
      const seqRow = (await c.query<{ last_seq: number }>(
        `INSERT INTO invoice_sequences(professional_user_id,last_seq) VALUES($1,1)
         ON CONFLICT (professional_user_id) DO UPDATE SET last_seq = invoice_sequences.last_seq + 1
         RETURNING last_seq`, [proId])).rows[0];
      const { seq, number } = nextInvoiceNumber(seqRow.last_seq - 1, year);
      await c.query(`UPDATE invoices SET seq=$1, number=$2, status='issued', issued_at=now() WHERE id=$3`, [seq, number, invoiceId]);
      return { ok: true, seq, number };
    });
  }

  async cancel(invoiceId: string, proId: string): Promise<InvoiceOpResult> {
    const row = (await this.pool.query<{ status: InvoiceStatus }>(
      'SELECT status FROM invoices WHERE id=$1 AND professional_user_id=$2', [invoiceId, proId])).rows[0];
    if (!row) return { ok: false, reason: 'not_found' };
    if (!canTransition(row.status, 'cancelled')) return { ok: false, reason: 'invalid_transition' };
    await this.pool.query(`UPDATE invoices SET status='cancelled' WHERE id=$1`, [invoiceId]);
    return { ok: true };
  }

  async deleteDraft(invoiceId: string, proId: string): Promise<InvoiceOpResult> {
    const row = (await this.pool.query<{ status: InvoiceStatus }>(
      'SELECT status FROM invoices WHERE id=$1 AND professional_user_id=$2', [invoiceId, proId])).rows[0];
    if (!row) return { ok: false, reason: 'not_found' };
    if (!canDelete(row.status)) return { ok: false, reason: 'not_draft' };
    await this.pool.query(`DELETE FROM invoices WHERE id=$1 AND status='draft'`, [invoiceId]);
    return { ok: true };
  }
}

export class PgSubscriptionRepo implements SubscriptionRepoPort {
  constructor(private db: Db) {}
  async get(proId: string): Promise<SubState | null> {
    const r = (await this.db.query<{ plan: SubState['plan']; status: SubState['status']; current_period_end: Date | null; last_event_at: string | null }>(
      'SELECT plan,status,current_period_end,last_event_at FROM subscriptions WHERE professional_user_id=$1', [proId])).rows[0];
    if (!r) return null;
    return { plan: r.plan, status: r.status, currentPeriodEnd: r.current_period_end, lastEventAt: r.last_event_at === null ? null : Number(r.last_event_at) };
  }
  async save(proId: string, s: SubState): Promise<void> {
    await this.db.query(
      `INSERT INTO subscriptions(professional_user_id,provider,plan,status,current_period_end,last_event_at)
       VALUES($1,'stripe',$2,$3,$4,$5)
       ON CONFLICT (professional_user_id) WHERE professional_user_id IS NOT NULL
       DO UPDATE SET plan=EXCLUDED.plan, status=EXCLUDED.status,
                     current_period_end=EXCLUDED.current_period_end, last_event_at=EXCLUDED.last_event_at`,
      [proId, s.plan, s.status, s.currentPeriodEnd, s.lastEventAt]);
  }
}

async function caseCtx(db: Db, caseId: string): Promise<CaseCtx | null> {
  const c = (await db.query<{ professional_user_id: string; client_user_id: string | null }>(
    'SELECT professional_user_id, client_user_id FROM cases WHERE id=$1', [caseId])).rows[0];
  if (!c) return null;
  const parts = (await db.query<{ user_id: string }>('SELECT user_id FROM case_participants WHERE case_id=$1', [caseId])).rows.map(r => r.user_id);
  if (c.client_user_id && !parts.includes(c.client_user_id)) parts.push(c.client_user_id);
  return { ownerProId: c.professional_user_id, participantUserIds: parts };
}

export function makeLot3Services(pool: Pool, deps: {
  storage: FileStoragePort;
  email: EmailQueuePort;
  files?: Lot3Services['files'];
  visioAllowedHosts?: string[];
}): Lot3Services {
  return {
    cases: { ctx: (id) => caseCtx(pool, id) },
    messages: {
      async list(caseId) {
        const r = await pool.query<{ id: string; sender_user_id: string; body: string; internal_note: boolean; delivery_status: CaseMessage['deliveryStatus']; created_at: Date }>(
          'SELECT id,sender_user_id,body,internal_note,delivery_status,created_at FROM messages WHERE case_id=$1 ORDER BY created_at', [caseId]);
        return r.rows.map(m => ({ id: m.id, senderUserId: m.sender_user_id, body: m.body, internalNote: m.internal_note, deliveryStatus: m.delivery_status, createdAt: m.created_at }));
      },
      async post(i) {
        const id = (await pool.query<{ id: string }>(
          `INSERT INTO messages(case_id,sender_user_id,body,internal_note,delivery_status) VALUES($1,$2,$3,$4,'stored') RETURNING id`,
          [i.caseId, i.senderUserId, i.body, i.internalNote])).rows[0].id;
        if (i.notifyUserIds.length) {
          const to = await pool.query<{ id: string; email: string }>('SELECT id,email FROM users WHERE id = ANY($1::uuid[])', [i.notifyUserIds]);
          const n = notificationEmail();     // générique : jamais le contenu juridique
          for (const u of to.rows) await deps.email.enqueue({ to: u.email, subject: n.subject, body: n.body, idempotencyKey: `msg:${id}:${u.id}` });
        }
        // 'stored' : le statut passe à delivered/failed lors du traitement de la file.
        return { id, deliveryStatus: 'stored' };
      },
    },
    documents: {
      async ctxOf(docId) {
        const d = (await pool.query<{ case_id: string }>('SELECT case_id FROM documents WHERE id=$1', [docId])).rows[0];
        if (!d) return null;
        const ctx = await caseCtx(pool, d.case_id);
        return ctx ? { ...ctx, caseId: d.case_id } : null;
      },
      async usage(ownerProId) {
        const r = await pool.query<{ used: string }>(
          `SELECT COALESCE(SUM(d.size_bytes),0) AS used FROM documents d JOIN cases c ON c.id=d.case_id WHERE c.professional_user_id=$1`, [ownerProId]);
        return { usedBytes: Number(r.rows[0].used), limitBytes: DEFAULT_QUOTA_BYTES };
      },
      async create(i) {
        const key = randomUUID().replace(/-/g, '');
        await deps.storage.put(key, i.bytes, i.mime);
        try {
          const id = (await pool.query<{ id: string }>(
            `INSERT INTO documents(case_id,owner_user_id,storage_key,filename,mime,size_bytes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
            [i.caseId, i.ownerUserId, key, i.safeName, i.mime, i.bytes.length])).rows[0].id;
          return { id };
        } catch (e) {
          await deps.storage.remove(key);   // pas d'objet orphelin si l'écriture base échoue
          throw e;
        }
      },
      async signedUrl(docId, ttl) {
        const k = (await pool.query<{ storage_key: string }>('SELECT storage_key FROM documents WHERE id=$1', [docId])).rows[0];
        if (!k) throw new Error('document introuvable');
        return deps.storage.signedUrl(k.storage_key, ttl);
      },
      async remove(docId) {
        const k = (await pool.query<{ storage_key: string }>('DELETE FROM documents WHERE id=$1 RETURNING storage_key', [docId])).rows[0];
        if (k) await deps.storage.remove(k.storage_key);
      },
    },
    invoices: new PgInvoiceRepo(pool),
    subscriptions: new PgSubscriptionRepo(pool),
    profile: {
      async setTeleconsultUrl(proId, url) {
        await pool.query('UPDATE professional_profiles SET teleconsult_url=$1, updated_at=now() WHERE user_id=$2', [url, proId]);
      },
    },
    files: deps.files,
    visioAllowedHosts: deps.visioAllowedHosts,
  };
}

export { inTx };
