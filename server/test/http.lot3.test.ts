// HTTP Lot 3 de bout en bout (inject) sur dépôts SQLite réels + stockage disque
// privé à liens signés. Exécuter avec --experimental-sqlite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/http/app';
import type { Services } from '../src/http/services';
import type { Lot3Services } from '../src/http/lot3';
import type { CaseCtx, CaseMessage } from '../src/domain/messaging';
import { createTestDb, SqliteInvoiceRepo, SqliteSubscriptionRepo } from '../src/adapters/sqlite';
import { DiskPrivateStorage } from '../src/adapters/diskStorage';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

function harness(opts: { quotaBytes?: number } = {}) {
  const db = createTestDb();
  const clock = { ms: Date.UTC(2026, 9, 26, 10, 0, 0) };
  const storage = new DiskPrivateStorage(mkdtempSync(path.join(tmpdir(), 'prima-files-')), 'test-secret-lot3', () => clock.ms);
  const cases = new Map<string, CaseCtx>([['case1', { ownerProId: 'proA', participantUserIds: ['cliA'] }]]);
  const messages: Array<CaseMessage & { caseId: string }> = [];
  const notified: string[][] = [];
  const docs = new Map<string, { caseId: string; key: string; size: number; ownerProId: string }>();
  const subs = new SqliteSubscriptionRepo(db);

  const lot3: Lot3Services = {
    cases: { ctx: async (id) => cases.get(id) ?? null },
    messages: {
      list: async (caseId) => messages.filter(m => m.caseId === caseId),
      post: async (i) => {
        const m = { id: randomUUID(), caseId: i.caseId, senderUserId: i.senderUserId, body: i.body, internalNote: i.internalNote, deliveryStatus: 'stored' as const, createdAt: new Date() };
        messages.push(m); notified.push(i.notifyUserIds);
        return { id: m.id, deliveryStatus: m.deliveryStatus };
      },
    },
    documents: {
      ctxOf: async (docId) => { const d = docs.get(docId); if (!d) return null; const c = cases.get(d.caseId)!; return { ...c, caseId: d.caseId }; },
      usage: async (proId) => ({ usedBytes: [...docs.values()].filter(d => d.ownerProId === proId).reduce((t, d) => t + d.size, 0), limitBytes: opts.quotaBytes ?? 1024 * 1024 }),
      create: async (i) => { const id = randomUUID(); const key = randomUUID().replace(/-/g, ''); await storage.put(key, i.bytes); docs.set(id, { caseId: i.caseId, key, size: i.bytes.length, ownerProId: i.ownerProId }); return { id }; },
      signedUrl: async (docId, ttl) => storage.signedUrl(docs.get(docId)!.key, ttl),
      remove: async (docId) => { const d = docs.get(docId); if (d) { await storage.remove(d.key); docs.delete(docId); } },
    },
    invoices: new SqliteInvoiceRepo(db),
    subscriptions: subs,
    profile: { setTeleconsultUrl: async () => {} },
    files: { verify: (k, e, s) => storage.verify(k, e, s), read: (k) => storage.read(k) },
    now: () => new Date(clock.ms),
  };

  const actors: Record<string, { userId: string; role: 'particulier' | 'professionnel' }> = {
    'sid-proA': { userId: 'proA', role: 'professionnel' }, 'sid-proB': { userId: 'proB', role: 'professionnel' },
    'sid-cliA': { userId: 'cliA', role: 'particulier' }, 'sid-cliB': { userId: 'cliB', role: 'particulier' },
  };
  const services = {
    session: { actorForSession: async (sid: string | undefined) => (sid ? actors[sid] ?? null : null) },
    lot3,
  } as unknown as Services;

  const app = buildApp(services, { cookieSecure: false });
  const as = (sid: string) => ({ cookies: { sid, csrf: 't' }, headers: { 'x-csrf-token': 't' } });
  return { app, as, clock, subs, notified, messages };
}

test('messages : participant voit le fil sans les notes internes ; tiers refusé', async () => {
  const h = harness();
  assert.equal((await h.app.inject({ method: 'POST', url: '/cases/case1/messages', ...h.as('sid-proA'), payload: { body: 'Bonjour', internalNote: false } })).statusCode, 201);
  assert.equal((await h.app.inject({ method: 'POST', url: '/cases/case1/messages', ...h.as('sid-proA'), payload: { body: 'Stratégie', internalNote: true } })).statusCode, 201);
  assert.deepEqual(h.notified, [['cliA'], []]);   // aucune notification pour une note interne

  const cli = await h.app.inject({ method: 'GET', url: '/cases/case1/messages', ...h.as('sid-cliA') });
  assert.equal(cli.statusCode, 200);
  assert.deepEqual(cli.json().messages.map((m: { body: string }) => m.body), ['Bonjour']);

  assert.equal((await h.app.inject({ method: 'GET', url: '/cases/case1/messages', ...h.as('sid-proB') })).statusCode, 403);
  assert.equal((await h.app.inject({ method: 'GET', url: '/cases/case1/messages', ...h.as('sid-cliB') })).statusCode, 403);
  assert.equal((await h.app.inject({ method: 'POST', url: '/cases/case1/messages', ...h.as('sid-cliA'), payload: { body: 'x', internalNote: true } })).statusCode, 403);
  assert.equal((await h.app.inject({ method: 'GET', url: '/cases/nope/messages', ...h.as('sid-proA') })).statusCode, 404);
  await h.app.close();
});

test('pièces : dépôt validé, contenu falsifié refusé, quota visible, téléchargement par lien signé', async () => {
  const h = harness({ quotaBytes: PDF.length + 5 });
  const up = await h.app.inject({ method: 'POST', url: '/cases/case1/documents', ...h.as('sid-cliA'), payload: { filename: '../pieces/bulletin.pdf', mime: 'application/pdf', contentBase64: PDF.toString('base64') } });
  assert.equal(up.statusCode, 201);
  const docId = up.json().id as string;

  const fake = await h.app.inject({ method: 'POST', url: '/cases/case1/documents', ...h.as('sid-cliA'), payload: { filename: 'x.pdf', mime: 'application/pdf', contentBase64: PNG.toString('base64') } });
  assert.deepEqual([fake.statusCode, fake.json().error], [422, 'content_mismatch']);

  const full = await h.app.inject({ method: 'POST', url: '/cases/case1/documents', ...h.as('sid-proA'), payload: { filename: 'y.pdf', mime: 'application/pdf', contentBase64: PDF.toString('base64') } });
  assert.deepEqual([full.statusCode, full.json().error], [413, 'quota_exceeded']);

  assert.equal((await h.app.inject({ method: 'POST', url: '/cases/case1/documents', ...h.as('sid-cliB'), payload: { filename: 'z.pdf', mime: 'application/pdf', contentBase64: PDF.toString('base64') } })).statusCode, 403);
  assert.equal((await h.app.inject({ method: 'GET', url: `/documents/${docId}/download`, ...h.as('sid-cliB') })).statusCode, 403);

  const dl = await h.app.inject({ method: 'GET', url: `/documents/${docId}/download`, ...h.as('sid-cliA') });
  assert.equal(dl.statusCode, 200);
  const url = dl.json().url as string;
  const file = await h.app.inject({ method: 'GET', url });
  assert.equal(file.statusCode, 200);
  assert.ok(Buffer.from(file.rawPayload).equals(PDF));
  assert.equal(file.headers['cache-control'], 'private, no-store');

  assert.equal((await h.app.inject({ method: 'GET', url: url.replace(/sig=[0-9a-f]{4}/, 'sig=0000') })).statusCode, 403);   // lien altéré
  h.clock.ms += 301_000;
  assert.equal((await h.app.inject({ method: 'GET', url })).statusCode, 403);                                              // lien expiré

  assert.equal((await h.app.inject({ method: 'DELETE', url: `/documents/${docId}`, ...h.as('sid-cliA') })).statusCode, 403);
  assert.equal((await h.app.inject({ method: 'DELETE', url: `/documents/${docId}`, ...h.as('sid-proA') })).statusCode, 200);
  await h.app.close();
});

test('facturation : réservée au pro, brouillon → émission, cloisonnement, pas de suppression d’une émise', async () => {
  const h = harness();
  assert.equal((await h.app.inject({ method: 'POST', url: '/invoices', ...h.as('sid-cliA'), payload: { amountCents: 1000 } })).statusCode, 403);
  const neg = await h.app.inject({ method: 'POST', url: '/invoices', ...h.as('sid-proA'), payload: { amountCents: -1000 } });
  assert.deepEqual([neg.statusCode, neg.json().error], [422, 'invalid_amount']);

  const d = await h.app.inject({ method: 'POST', url: '/invoices', ...h.as('sid-proA'), payload: { amountCents: 15000, service: 'Consultation' } });
  assert.equal(d.statusCode, 201);
  const invId = d.json().id as string;

  assert.equal((await h.app.inject({ method: 'POST', url: `/invoices/${invId}/issue`, ...h.as('sid-proB') })).statusCode, 404);
  const issued = await h.app.inject({ method: 'POST', url: `/invoices/${invId}/issue`, ...h.as('sid-proA') });
  assert.deepEqual([issued.statusCode, issued.json().number], [200, 'F-2026-000001']);

  assert.equal((await h.app.inject({ method: 'DELETE', url: `/invoices/${invId}`, ...h.as('sid-proA') })).statusCode, 409);
  assert.equal((await h.app.inject({ method: 'POST', url: `/invoices/${invId}/cancel`, ...h.as('sid-proA') })).statusCode, 200);
  await h.app.close();
});

test('abonnement : niveau effectif calculé serveur ; client refusé', async () => {
  const h = harness();
  assert.deepEqual((await h.app.inject({ method: 'GET', url: '/subscription', ...h.as('sid-proA') })).json(), { tier: 'gratuit', status: 'none' });
  await h.subs.save('proA', { plan: 'premium', status: 'active', currentPeriodEnd: new Date(h.clock.ms + 20 * 86400_000), lastEventAt: 1 });
  assert.deepEqual((await h.app.inject({ method: 'GET', url: '/subscription', ...h.as('sid-proA') })).json(), { tier: 'premium', status: 'active' });
  assert.equal((await h.app.inject({ method: 'GET', url: '/subscription', ...h.as('sid-cliA') })).statusCode, 403);
  await h.app.close();
});

test('téléconsultation : seuls les liens https de fournisseurs autorisés sont acceptés', async () => {
  const h = harness();
  const put = (url: string | null, sid = 'sid-proA') => h.app.inject({ method: 'PUT', url: '/pro/teleconsult-url', ...h.as(sid), payload: { url } });
  assert.deepEqual((await put('javascript:alert(1)')).json(), { error: 'scheme_not_allowed' });
  assert.deepEqual((await put('https://evil.example/room')).json(), { error: 'host_not_allowed' });
  const ok = await put('https://meet.jit.si/prima-cabinet');
  assert.deepEqual([ok.statusCode, ok.json().url], [200, 'https://meet.jit.si/prima-cabinet']);
  assert.equal((await put('https://meet.jit.si/x', 'sid-cliA')).statusCode, 403);
  await h.app.close();
});
