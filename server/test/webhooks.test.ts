import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyStripeSignature, shouldProcessEvent } from '../src/domain/webhooks';

const SECRET = 'whsec_test_dummy';
function sign(payload: string, t: number, secret = SECRET): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

test('signature valide acceptée dans la fenêtre de tolérance', () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const now = 1_800_000_000;
  const hdr = sign(payload, now);
  assert.equal(verifyStripeSignature(payload, hdr, SECRET, { nowSec: now }), true);
});

test('payload altéré → rejeté', () => {
  const now = 1_800_000_000;
  const hdr = sign('{"id":"evt_1"}', now);
  assert.equal(verifyStripeSignature('{"id":"evt_HACK"}', hdr, SECRET, { nowSec: now }), false);
});

test('mauvais secret → rejeté', () => {
  const payload = '{"id":"evt_1"}';
  const now = 1_800_000_000;
  const hdr = sign(payload, now, 'whsec_autre');
  assert.equal(verifyStripeSignature(payload, hdr, SECRET, { nowSec: now }), false);
});

test('horodatage hors tolérance → rejeté (anti-rejeu)', () => {
  const payload = '{"id":"evt_1"}';
  const t = 1_800_000_000;
  const hdr = sign(payload, t);
  assert.equal(verifyStripeSignature(payload, hdr, SECRET, { nowSec: t + 10_000 }), false);
});

test('idempotence : un événement déjà vu n’est pas retraité', () => {
  const seen = new Set<string>(['evt_1']);
  assert.equal(shouldProcessEvent('evt_1', seen), false);
  assert.equal(shouldProcessEvent('evt_2', seen), true);
  assert.equal(shouldProcessEvent('', seen), false);
});
