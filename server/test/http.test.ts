import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/http/app';
import type { Services } from '../src/http/services';

function fakeServices(over: Partial<Services> = {}): Services {
  const base: Services = {
    session: {
      actorForSession: async (sid) =>
        sid === 'sid-client' ? { userId: 'cli1', role: 'particulier' }
        : sid === 'sid-pro' ? { userId: 'pro1', role: 'professionnel' }
        : sid === 'sid-admin' ? { userId: 'adm', role: 'admin', mfa: true }
        : sid === 'sid-admin-nomfa' ? { userId: 'adm', role: 'admin', mfa: false }
        : null,
    },
    auth: {
      register: async () => ({ sessionId: 'sid-new' }),
      login: async () => ({ sessionId: 'sid-x' }),
      logout: async () => {},
      requestReset: async () => {},
      confirmReset: async () => true,
    },
    slots: { forPro: async () => ['2026-01-19T08:00:00.000Z'] },
    appts: {
      book: async () => ({ ok: true, appointmentId: 'a1' }),
      ownerOf: async (id) => (id === 'owned' ? 'pro1' : 'proX'),
      setStatus: async () => {},
    },
    verification: { decide: async () => {} },
    billing: { checkout: async () => ({ url: 'https://pay.example/test' }) },
    webhook: { handleStripe: async (_p, sig) => (sig === 'good' ? { status: 200 } : { status: 400 }) },
  };
  return { ...base, ...over };
}

const booted = (over?: Partial<Services>) => buildApp(fakeServices(over), { cookieSecure: false });

test('GET /health public → 200', async () => {
  const app = booted(); const r = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(r.statusCode, 200); await app.close();
});

test('GET /me sans session → 401 ; avec session → 200', async () => {
  const app = booted();
  assert.equal((await app.inject({ method: 'GET', url: '/me' })).statusCode, 401);
  const ok = await app.inject({ method: 'GET', url: '/me', cookies: { sid: 'sid-client' } });
  assert.equal(ok.statusCode, 200); assert.equal(ok.json().role, 'particulier');
  await app.close();
});

test('POST /appointments sans session → 401', async () => {
  const app = booted();
  const r = await app.inject({ method: 'POST', url: '/appointments', payload: { proId: 'pro1', startUtc: '2026-01-19T08:00:00.000Z', endUtc: '2026-01-19T08:30:00.000Z' } });
  assert.equal(r.statusCode, 401); await app.close();
});

test('CSRF : POST authentifié sans jeton → 403 ; avec double-submit → 201', async () => {
  const app = booted();
  const payload = { proId: 'pro1', startUtc: '2026-01-19T08:00:00.000Z', endUtc: '2026-01-19T08:30:00.000Z' };
  const noCsrf = await app.inject({ method: 'POST', url: '/appointments', cookies: { sid: 'sid-client' }, payload });
  assert.equal(noCsrf.statusCode, 403);
  const ok = await app.inject({ method: 'POST', url: '/appointments', cookies: { sid: 'sid-client', csrf: 'tok' }, headers: { 'x-csrf-token': 'tok' }, payload });
  assert.equal(ok.statusCode, 201); assert.equal(ok.json().appointmentId, 'a1');
  await app.close();
});

test('réservation sur créneau pris → 409', async () => {
  const app = booted({ appts: { book: async () => ({ ok: false, reason: 'slot_taken' }), ownerOf: async () => 'pro1', setStatus: async () => {} } });
  const r = await app.inject({ method: 'POST', url: '/appointments', cookies: { sid: 'sid-client', csrf: 't' }, headers: { 'x-csrf-token': 't' }, payload: { proId: 'pro1', startUtc: '2026-01-19T08:00:00.000Z', endUtc: '2026-01-19T08:30:00.000Z' } });
  assert.equal(r.statusCode, 409); await app.close();
});

test('autorisation : confirmer le RDV d’un autre cabinet → 403 ; le sien → 200', async () => {
  const app = booted();
  const other = await app.inject({ method: 'POST', url: '/appointments/notmine/confirm', cookies: { sid: 'sid-pro', csrf: 't' }, headers: { 'x-csrf-token': 't' } });
  assert.equal(other.statusCode, 403); // ownerOf='proX' ≠ pro1
  const mine = await app.inject({ method: 'POST', url: '/appointments/owned/confirm', cookies: { sid: 'sid-pro', csrf: 't' }, headers: { 'x-csrf-token': 't' } });
  assert.equal(mine.statusCode, 200);
  await app.close();
});

test('admin : vérification exige MFA', async () => {
  const app = booted();
  const noMfa = await app.inject({ method: 'POST', url: '/admin/verify', cookies: { sid: 'sid-admin-nomfa', csrf: 't' }, headers: { 'x-csrf-token': 't' }, payload: { proId: 'pro1', decision: 'approved' } });
  assert.equal(noMfa.statusCode, 403);
  const withMfa = await app.inject({ method: 'POST', url: '/admin/verify', cookies: { sid: 'sid-admin', csrf: 't' }, headers: { 'x-csrf-token': 't' }, payload: { proId: 'pro1', decision: 'approved' } });
  assert.equal(withMfa.statusCode, 200);
  // un pro ne peut pas décider de la vérification
  const pro = await app.inject({ method: 'POST', url: '/admin/verify', cookies: { sid: 'sid-pro', csrf: 't' }, headers: { 'x-csrf-token': 't' }, payload: { proId: 'pro1', decision: 'approved' } });
  assert.equal(pro.statusCode, 403);
  await app.close();
});

test('reset : réponse uniforme 202 (anti-énumération)', async () => {
  const app = booted();
  const r = await app.inject({ method: 'POST', url: '/auth/reset/request', payload: { email: 'inconnu@test.local' } });
  assert.equal(r.statusCode, 202); await app.close();
});

test('webhook Stripe : mauvaise signature → 400 ; bonne → 200 (sans session/CSRF)', async () => {
  const app = booted();
  const bad = await app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'stripe-signature': 'bad' }, payload: { id: 'evt_1' } });
  assert.equal(bad.statusCode, 400);
  const good = await app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'stripe-signature': 'good' }, payload: { id: 'evt_1' } });
  assert.equal(good.statusCode, 200);
  await app.close();
});
