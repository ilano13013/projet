/**
 * Adaptateur SQLite (node:sqlite) — DÉVELOPPEMENT / TESTS uniquement.
 * Reproduit fidèlement les contraintes de production (index unique partiel
 * anti-double-réservation, unicité d'événement webhook) pour des tests
 * d'intégration RÉELLEMENT exécutables. La production utilise PostgreSQL
 * (voir pg.ts + migrations/001_init.sql).
 *
 * Exécuter les tests avec le drapeau : `node --experimental-sqlite ...`.
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { AppointmentRepoPort, BookingResult } from '../ports';
import { isValidAmountCents, nextInvoiceNumber, canDelete, canTransition, type InvoiceStatus } from '../domain/invoicing';
import type { InvoiceRepoPort, SubscriptionRepoPort, DraftResult, IssueResult, InvoiceOpResult } from '../ports';
import type { SubState } from '../domain/entitlements';

export function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE appointments(
      id TEXT PRIMARY KEY,
      professional_user_id TEXT NOT NULL,
      client_user_id TEXT,
      appointment_type_id TEXT,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      motif TEXT
    );
    CREATE UNIQUE INDEX ux_appt_active_slot
      ON appointments(professional_user_id, start_at)
      WHERE status IN ('pending','confirmed');

    CREATE TABLE webhook_events(
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      type TEXT NOT NULL,
      received_at TEXT NOT NULL,
      UNIQUE(provider, provider_event_id)
    );

    CREATE TABLE invoice_sequences(
      professional_user_id TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE invoices(
      id TEXT PRIMARY KEY,
      professional_user_id TEXT NOT NULL,
      client_user_id TEXT,
      case_id TEXT,
      seq INTEGER,
      number TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      service TEXT,
      issued_at TEXT,
      UNIQUE(professional_user_id, seq),
      UNIQUE(professional_user_id, number)
    );

    CREATE TABLE subscriptions(
      professional_user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL,
      status TEXT NOT NULL,
      current_period_end TEXT,
      last_event_at INTEGER
    );
  `);
  return db;
}

function isUnique(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  const s = `${err?.code ?? ''} ${err?.message ?? ''}`;
  return /UNIQUE|constraint failed/i.test(s);
}

export class SqliteAppointmentRepo implements AppointmentRepoPort {
  constructor(private db: DatabaseSync, private idgen: () => string = randomUUID) {}
  async bookTransactional(input: {
    professionalUserId: string; clientUserId?: string; appointmentTypeId?: string;
    startUtc: Date; endUtc: Date; motif?: string;
  }): Promise<BookingResult> {
    const id = this.idgen();
    try {
      this.db.prepare(
        `INSERT INTO appointments(id,professional_user_id,client_user_id,appointment_type_id,start_at,end_at,status,motif)
         VALUES(?,?,?,?,?,?, 'pending', ?)`,
      ).run(
        id, input.professionalUserId, input.clientUserId ?? null, input.appointmentTypeId ?? null,
        input.startUtc.toISOString(), input.endUtc.toISOString(), input.motif ?? null,
      );
      return { ok: true, appointmentId: id };
    } catch (e) {
      if (isUnique(e)) return { ok: false, reason: 'slot_taken' };
      throw e;
    }
  }
}

/** Enregistre un événement webhook une seule fois (idempotence par unicité). */
export function recordWebhookOnce(db: DatabaseSync, provider: string, eventId: string, type: string): boolean {
  try {
    db.prepare('INSERT INTO webhook_events(provider,provider_event_id,type,received_at) VALUES(?,?,?,?)')
      .run(provider, eventId, type, new Date().toISOString());
    return true;   // premier traitement
  } catch (e) {
    if (isUnique(e)) return false;   // déjà vu → ne pas retraiter
    throw e;
  }
}

/* ───────────── Lot 3 : facturation & abonnement (dev/test) ───────────── */

function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export class SqliteInvoiceRepo implements InvoiceRepoPort {
  constructor(private db: DatabaseSync, private idgen: () => string = randomUUID) {}

  async createDraft(input: { professionalUserId: string; clientUserId?: string; caseId?: string; amountCents: number; service?: string }): Promise<DraftResult> {
    if (!isValidAmountCents(input.amountCents)) return { ok: false, reason: 'invalid_amount' };
    const id = this.idgen();
    this.db.prepare(`INSERT INTO invoices(id,professional_user_id,client_user_id,case_id,status,amount_cents,service)
                     VALUES(?,?,?,?, 'draft', ?, ?)`)
      .run(id, input.professionalUserId, input.clientUserId ?? null, input.caseId ?? null, input.amountCents, input.service ?? null);
    return { ok: true, id };
  }

  async issue(invoiceId: string, professionalUserId: string, year: number): Promise<IssueResult> {
    return tx(this.db, (): IssueResult => {
      const row = this.db.prepare('SELECT status FROM invoices WHERE id=? AND professional_user_id=?')
        .get(invoiceId, professionalUserId) as { status: InvoiceStatus } | undefined;
      if (!row) return { ok: false, reason: 'not_found' };
      if (row.status !== 'draft') return { ok: false, reason: 'not_draft' };
      const seqRow = this.db.prepare(
        `INSERT INTO invoice_sequences(professional_user_id,last_seq) VALUES(?,1)
         ON CONFLICT(professional_user_id) DO UPDATE SET last_seq = last_seq + 1
         RETURNING last_seq`).get(professionalUserId) as { last_seq: number };
      const { seq, number } = nextInvoiceNumber(seqRow.last_seq - 1, year);
      this.db.prepare(`UPDATE invoices SET seq=?, number=?, status='issued', issued_at=? WHERE id=?`)
        .run(seq, number, new Date().toISOString(), invoiceId);
      return { ok: true, seq, number };
    });
  }

  async cancel(invoiceId: string, professionalUserId: string): Promise<InvoiceOpResult> {
    const row = this.db.prepare('SELECT status FROM invoices WHERE id=? AND professional_user_id=?')
      .get(invoiceId, professionalUserId) as { status: InvoiceStatus } | undefined;
    if (!row) return { ok: false, reason: 'not_found' };
    if (!canTransition(row.status, 'cancelled')) return { ok: false, reason: 'invalid_transition' };
    this.db.prepare(`UPDATE invoices SET status='cancelled' WHERE id=?`).run(invoiceId);
    return { ok: true };
  }

  async deleteDraft(invoiceId: string, professionalUserId: string): Promise<InvoiceOpResult> {
    const row = this.db.prepare('SELECT status FROM invoices WHERE id=? AND professional_user_id=?')
      .get(invoiceId, professionalUserId) as { status: InvoiceStatus } | undefined;
    if (!row) return { ok: false, reason: 'not_found' };
    if (!canDelete(row.status)) return { ok: false, reason: 'not_draft' };
    this.db.prepare('DELETE FROM invoices WHERE id=?').run(invoiceId);
    return { ok: true };
  }
}

export class SqliteSubscriptionRepo implements SubscriptionRepoPort {
  constructor(private db: DatabaseSync) {}
  async get(proId: string): Promise<SubState | null> {
    const r = this.db.prepare('SELECT plan,status,current_period_end,last_event_at FROM subscriptions WHERE professional_user_id=?')
      .get(proId) as { plan: SubState['plan']; status: SubState['status']; current_period_end: string | null; last_event_at: number | null } | undefined;
    if (!r) return null;
    return { plan: r.plan, status: r.status, currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end) : null, lastEventAt: r.last_event_at };
  }
  async save(proId: string, s: SubState): Promise<void> {
    this.db.prepare(`INSERT INTO subscriptions(professional_user_id,plan,status,current_period_end,last_event_at) VALUES(?,?,?,?,?)
                     ON CONFLICT(professional_user_id) DO UPDATE SET plan=excluded.plan, status=excluded.status,
                       current_period_end=excluded.current_period_end, last_event_at=excluded.last_event_at`)
      .run(proId, s.plan, s.status, s.currentPeriodEnd ? s.currentPeriodEnd.toISOString() : null, s.lastEventAt);
  }
}
