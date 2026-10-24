// Tests d'intégration RÉELS sur node:sqlite (exécuter avec --experimental-sqlite).
// Reproduisent les contraintes de production Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, SqliteAppointmentRepo, recordWebhookOnce } from '../src/adapters/sqlite';

test('FUN-02 : deux réservations sur le même créneau, une seule gagne', async () => {
  const db = createTestDb();
  const repo = new SqliteAppointmentRepo(db);
  const s = new Date('2026-01-19T08:00:00Z'), e = new Date('2026-01-19T08:30:00Z');
  const [r1, r2] = await Promise.all([
    repo.bookTransactional({ professionalUserId: 'pro1', startUtc: s, endUtc: e }),
    repo.bookTransactional({ professionalUserId: 'pro1', startUtc: s, endUtc: e }),
  ]);
  assert.equal([r1, r2].filter(r => r.ok).length, 1);
  assert.ok([r1, r2].some(r => !r.ok && r.reason === 'slot_taken'));
});

test('créneau différent ou autre professionnel : réservable', async () => {
  const db = createTestDb();
  const repo = new SqliteAppointmentRepo(db);
  const s = new Date('2026-01-19T08:00:00Z'), e = new Date('2026-01-19T08:30:00Z');
  const a = await repo.bookTransactional({ professionalUserId: 'pro1', startUtc: s, endUtc: e });
  const b = await repo.bookTransactional({ professionalUserId: 'pro2', startUtc: s, endUtc: e }); // autre pro
  const c = await repo.bookTransactional({ professionalUserId: 'pro1', startUtc: new Date('2026-01-19T09:00:00Z'), endUtc: new Date('2026-01-19T09:30:00Z') });
  assert.ok(a.ok && b.ok && c.ok);
});

test('créneau libéré (annulation) redevient réservable', async () => {
  const db = createTestDb();
  const repo = new SqliteAppointmentRepo(db);
  const s = new Date('2026-01-19T08:00:00Z'), e = new Date('2026-01-19T08:30:00Z');
  const first = await repo.bookTransactional({ professionalUserId: 'pro1', startUtc: s, endUtc: e });
  assert.ok(first.ok);
  db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").run(first.ok ? first.appointmentId : '');
  const again = await repo.bookTransactional({ professionalUserId: 'pro1', startUtc: s, endUtc: e });
  assert.equal(again.ok, true); // l'index partiel n'inclut plus le RDV annulé
});

test('idempotence webhook en base : un event id n’est inséré qu’une fois', () => {
  const db = createTestDb();
  assert.equal(recordWebhookOnce(db, 'stripe', 'evt_1', 'checkout.session.completed'), true);
  assert.equal(recordWebhookOnce(db, 'stripe', 'evt_1', 'checkout.session.completed'), false);
  assert.equal(recordWebhookOnce(db, 'stripe', 'evt_2', 'invoice.paid'), true);
});
