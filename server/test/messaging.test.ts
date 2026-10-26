import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleMessages, canPost, notificationRecipients, notificationEmail, type CaseMessage, type CaseCtx } from '../src/domain/messaging';
import type { Actor } from '../src/domain/authz';

const ctx: CaseCtx = { ownerProId: 'proA', participantUserIds: ['cliA'] };
const proA: Actor = { userId: 'proA', role: 'professionnel' };
const proB: Actor = { userId: 'proB', role: 'professionnel' };
const cliA: Actor = { userId: 'cliA', role: 'particulier' };
const cliB: Actor = { userId: 'cliB', role: 'particulier' };

const msgs: CaseMessage[] = [
  { id: 'm1', senderUserId: 'proA', body: 'Bonjour', internalNote: false, deliveryStatus: 'delivered', createdAt: new Date() },
  { id: 'm2', senderUserId: 'proA', body: 'Note stratégie', internalNote: true, deliveryStatus: 'stored', createdAt: new Date() },
  { id: 'm3', senderUserId: 'cliA', body: 'Merci', internalNote: false, deliveryStatus: 'stored', createdAt: new Date() },
];

test('le pro propriétaire voit messages + notes internes', () => {
  assert.deepEqual(visibleMessages(msgs, proA, ctx).map(m => m.id), ['m1', 'm2', 'm3']);
});

test('le client participant voit les messages, PAS les notes internes', () => {
  assert.deepEqual(visibleMessages(msgs, cliA, ctx).map(m => m.id), ['m1', 'm3']);
});

test('un tiers (autre cabinet, autre client, non connecté) ne voit rien', () => {
  assert.equal(visibleMessages(msgs, proB, ctx).length, 0);
  assert.equal(visibleMessages(msgs, cliB, ctx).length, 0);
  assert.equal(visibleMessages(msgs, null, ctx).length, 0);
});

test('note interne : réservée au pro propriétaire', () => {
  assert.equal(canPost(proA, ctx, true), true);
  assert.equal(canPost(cliA, ctx, true), false);
  assert.equal(canPost(cliA, ctx, false), true);
  assert.equal(canPost(proB, ctx, false), false);
});

test('notification : destinataires hors expéditeur ; aucune pour une note interne', () => {
  assert.deepEqual(notificationRecipients(ctx, 'proA', false), ['cliA']);
  assert.deepEqual(notificationRecipients(ctx, 'cliA', false), ['proA']);
  assert.deepEqual(notificationRecipients(ctx, 'proA', true), []);
});

test('notification email : générique, sans contenu du message', () => {
  const n = notificationEmail();
  for (const m of msgs) assert.ok(!n.body.includes(m.body) && !n.subject.includes(m.body));
});
