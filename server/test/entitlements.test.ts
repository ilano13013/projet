import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTier, applyEvent, type SubState, type StripeEvt } from '../src/domain/entitlements';

const priceToPlan = (p: string) => (p === 'price_premium' ? 'premium' : p === 'price_expert' ? 'expert' : null);
const DAY = 86400_000;

function subEvt(id: string, type: string, created: number, status: string, price = 'price_premium', periodEnd = 1_900_000_000): StripeEvt {
  return { id, type, created, data: { object: { status, current_period_end: periodEnd, items: { data: [{ price: { id: price } }] } } } };
}

test('droits : absence d’abonnement → gratuit', () => {
  assert.equal(effectiveTier(null, new Date()), 'gratuit');
});

test('droits : actif dans la période → niveau payé', () => {
  const now = new Date('2026-10-26T00:00:00Z');
  const s: SubState = { plan: 'expert', status: 'active', currentPeriodEnd: new Date(now.getTime() + 10 * DAY), lastEventAt: 1 };
  assert.equal(effectiveTier(s, now), 'expert');
});

test('droits : impayé → maintenu pendant la grâce, puis gratuit', () => {
  const end = new Date('2026-10-26T00:00:00Z');
  const s: SubState = { plan: 'premium', status: 'past_due', currentPeriodEnd: end, lastEventAt: 1 };
  assert.equal(effectiveTier(s, new Date(end.getTime() + 3 * DAY)), 'premium');
  assert.equal(effectiveTier(s, new Date(end.getTime() + 8 * DAY)), 'gratuit');
});

test('droits : résilié → gratuit ; période expirée au-delà de la grâce → gratuit', () => {
  const end = new Date('2026-10-26T00:00:00Z');
  assert.equal(effectiveTier({ plan: 'premium', status: 'canceled', currentPeriodEnd: end, lastEventAt: 1 }, end), 'gratuit');
  assert.equal(effectiveTier({ plan: 'premium', status: 'active', currentPeriodEnd: end, lastEventAt: 1 }, new Date(end.getTime() + 30 * DAY)), 'gratuit');
});

test('événement : création d’abonnement applique plan + statut', () => {
  const r = applyEvent(null, subEvt('e1', 'customer.subscription.created', 100, 'active'), priceToPlan);
  assert.ok(r.applied);
  if (r.applied) { assert.equal(r.next.plan, 'premium'); assert.equal(r.next.status, 'active'); assert.equal(r.next.lastEventAt, 100); }
});

test('événement hors-ordre ignoré', () => {
  const prev: SubState = { plan: 'expert', status: 'active', currentPeriodEnd: null, lastEventAt: 200 };
  const r = applyEvent(prev, subEvt('e0', 'customer.subscription.updated', 150, 'canceled'), priceToPlan);
  assert.deepEqual(r, { applied: false, reason: 'out_of_order' });
});

test('checkout.session.completed n’active rien (seul l’abonnement signé fait foi)', () => {
  const r = applyEvent(null, { id: 'c1', type: 'checkout.session.completed', created: 10, data: { object: {} } }, priceToPlan);
  assert.deepEqual(r, { applied: false, reason: 'ignored' });
});

test('prix inconnu → refus (pas de niveau inventé)', () => {
  const r = applyEvent(null, subEvt('e1', 'customer.subscription.created', 100, 'active', 'price_inconnu'), priceToPlan);
  assert.deepEqual(r, { applied: false, reason: 'unknown_price' });
});

test('statut Stripe « unpaid » → past_due ; « incomplete_expired » → canceled', () => {
  const a = applyEvent(null, subEvt('e1', 'customer.subscription.updated', 1, 'unpaid'), priceToPlan);
  const b = applyEvent(null, subEvt('e2', 'customer.subscription.updated', 1, 'incomplete_expired'), priceToPlan);
  assert.ok(a.applied && a.next.status === 'past_due');
  assert.ok(b.applied && b.next.status === 'canceled');
});
