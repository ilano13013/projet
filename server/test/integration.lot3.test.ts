// Intégration Lot 3 sur node:sqlite (contraintes réelles). --experimental-sqlite requis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, SqliteInvoiceRepo, SqliteSubscriptionRepo, recordWebhookOnce } from '../src/adapters/sqlite';
import { processStripeEvent } from '../src/services/billing';
import { effectiveTier, type StripeEvt } from '../src/domain/entitlements';

const priceToPlan = (p: string) => (p === 'price_premium' ? 'premium' : p === 'price_expert' ? 'expert' : null);

test('facture : brouillon sans numéro, émission numérotée, montants ≤ 0 refusés', async () => {
  const db = createTestDb(); const repo = new SqliteInvoiceRepo(db);
  assert.deepEqual(await repo.createDraft({ professionalUserId: 'pro1', amountCents: -500 }), { ok: false, reason: 'invalid_amount' });
  assert.deepEqual(await repo.createDraft({ professionalUserId: 'pro1', amountCents: 0 }), { ok: false, reason: 'invalid_amount' });
  const d = await repo.createDraft({ professionalUserId: 'pro1', amountCents: 15000 });
  assert.ok(d.ok);
  if (!d.ok) return;
  const draftRow = db.prepare('SELECT number FROM invoices WHERE id=?').get(d.id) as { number: string | null };
  assert.equal(draftRow.number, null);
  assert.deepEqual(await repo.issue(d.id, 'pro1', 2026), { ok: true, seq: 1, number: 'F-2026-000001' });
});

test('facture : la contrainte base rejette aussi un montant négatif inséré directement', () => {
  const db = createTestDb();
  assert.throws(() => db.prepare("INSERT INTO invoices(id,professional_user_id,amount_cents) VALUES('x','pro1',-1)").run());
});

test('facture : émissions concurrentes → numéros distincts et consécutifs', async () => {
  const db = createTestDb(); const repo = new SqliteInvoiceRepo(db);
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) { const r = await repo.createDraft({ professionalUserId: 'pro1', amountCents: 100 + i }); if (r.ok) ids.push(r.id); }
  const results = await Promise.all(ids.map(id => repo.issue(id, 'pro1', 2026)));
  const numbers = results.map(r => (r.ok ? r.number : 'ERR')).sort();
  assert.deepEqual(numbers, ['F-2026-000001', 'F-2026-000002', 'F-2026-000003', 'F-2026-000004', 'F-2026-000005']);
});

test('facture : un brouillon supprimé ne consomme pas de numéro', async () => {
  const db = createTestDb(); const repo = new SqliteInvoiceRepo(db);
  const a = await repo.createDraft({ professionalUserId: 'pro1', amountCents: 100 });
  if (a.ok) assert.deepEqual(await repo.deleteDraft(a.id, 'pro1'), { ok: true });
  const b = await repo.createDraft({ professionalUserId: 'pro1', amountCents: 200 });
  if (b.ok) assert.deepEqual(await repo.issue(b.id, 'pro1', 2026), { ok: true, seq: 1, number: 'F-2026-000001' });
});

test('facture émise : ni suppression, ni ré-émission ; annulation possible ; autre cabinet = introuvable', async () => {
  const db = createTestDb(); const repo = new SqliteInvoiceRepo(db);
  const d = await repo.createDraft({ professionalUserId: 'pro1', amountCents: 100 });
  if (!d.ok) return;
  await repo.issue(d.id, 'pro1', 2026);
  assert.deepEqual(await repo.deleteDraft(d.id, 'pro1'), { ok: false, reason: 'not_draft' });
  assert.deepEqual(await repo.issue(d.id, 'pro1', 2026), { ok: false, reason: 'not_draft' });
  assert.deepEqual(await repo.issue(d.id, 'pro2', 2026), { ok: false, reason: 'not_found' });
  assert.deepEqual(await repo.cancel(d.id, 'pro2'), { ok: false, reason: 'not_found' });
  assert.deepEqual(await repo.cancel(d.id, 'pro1'), { ok: true });
  assert.deepEqual(await repo.cancel(d.id, 'pro1'), { ok: false, reason: 'invalid_transition' });
});

function evt(id: string, type: string, created: number, status: string, price = 'price_premium'): StripeEvt {
  return { id, type, created, data: { object: { status, current_period_end: 2_000_000_000, metadata: { pro_user_id: 'pro1' }, items: { data: [{ price: { id: price } }] } } } };
}

test('webhook → droits : activation, doublon, hors-ordre, impayé, résiliation', async () => {
  const db = createTestDb(); const subs = new SqliteSubscriptionRepo(db);
  const deps = { recordOnce: async (e: StripeEvt) => recordWebhookOnce(db, 'stripe', e.id, e.type), subs, priceToPlan };
  const now = new Date(1_900_000_000 * 1000);

  assert.equal(await processStripeEvent(evt('evt_1', 'customer.subscription.created', 100, 'active'), deps), 'applied');
  assert.equal(effectiveTier(await subs.get('pro1'), now), 'premium');

  // même événement rejoué : pas de double traitement
  assert.equal(await processStripeEvent(evt('evt_1', 'customer.subscription.created', 100, 'active'), deps), 'duplicate');

  // passage expert puis un ancien événement arrive en retard : ignoré
  assert.equal(await processStripeEvent(evt('evt_2', 'customer.subscription.updated', 300, 'active', 'price_expert'), deps), 'applied');
  assert.equal(await processStripeEvent(evt('evt_old', 'customer.subscription.updated', 200, 'canceled'), deps), 'out_of_order');
  assert.equal(effectiveTier(await subs.get('pro1'), now), 'expert');

  // retour navigateur / checkout seul : n'active rien
  assert.equal(await processStripeEvent({ id: 'cs_1', type: 'checkout.session.completed', created: 310, data: { object: { client_reference_id: 'pro1' } } }, deps), 'ignored');

  // impayé : statut past_due (grâce gérée par effectiveTier)
  assert.equal(await processStripeEvent({ id: 'in_1', type: 'invoice.payment_failed', created: 400, data: { object: { metadata: { pro_user_id: 'pro1' } } } }, deps), 'applied');
  assert.equal((await subs.get('pro1'))?.status, 'past_due');

  // résiliation → gratuit
  assert.equal(await processStripeEvent(evt('evt_del', 'customer.subscription.deleted', 500, 'canceled'), deps), 'applied');
  assert.equal(effectiveTier(await subs.get('pro1'), now), 'gratuit');
});
