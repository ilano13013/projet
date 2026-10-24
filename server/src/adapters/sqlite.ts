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
