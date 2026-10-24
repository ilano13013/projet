import test from 'node:test';
import assert from 'node:assert/strict';
import { can, type Actor } from '../src/domain/authz';

const proA: Actor = { userId: 'proA', role: 'professionnel' };
const proB: Actor = { userId: 'proB', role: 'professionnel' };
const clientA: Actor = { userId: 'cliA', role: 'particulier' };
const clientB: Actor = { userId: 'cliB', role: 'particulier' };
const admin: Actor = { userId: 'adm', role: 'admin' };

test('refus par défaut si non authentifié', () => {
  assert.equal(can(null, 'case:read', { ownerProId: 'proA' }), false);
  assert.equal(can(undefined, 'appointment:read'), false);
});

test('séparation des cabinets : proB ne lit/écrit pas le dossier de proA', () => {
  assert.equal(can(proA, 'case:write', { ownerProId: 'proA' }), true);
  assert.equal(can(proB, 'case:write', { ownerProId: 'proA' }), false);
  assert.equal(can(proB, 'case:read', { ownerProId: 'proA' }), false);
});

test('séparation des particuliers : un client ne lit pas le RDV d’un autre', () => {
  assert.equal(can(clientA, 'appointment:read', { clientUserId: 'cliA', ownerProId: 'proA' }), true);
  assert.equal(can(clientB, 'appointment:read', { clientUserId: 'cliA', ownerProId: 'proA' }), false);
});

test('écriture facture réservée au pro propriétaire', () => {
  assert.equal(can(proA, 'invoice:write', { ownerProId: 'proA' }), true);
  assert.equal(can(clientA, 'invoice:write', { ownerProId: 'proA', clientUserId: 'cliA' }), false);
});

test('téléchargement de document : participant au dossier uniquement', () => {
  assert.equal(can(clientA, 'document:download', { participantUserIds: ['cliA'], ownerProId: 'proA' }), true);
  assert.equal(can(clientB, 'document:download', { participantUserIds: ['cliA'], ownerProId: 'proA' }), false);
});

test('admin : décide la vérification, mais pas d’accès au contenu des affaires', () => {
  assert.equal(can(admin, 'verification:decide'), true);
  assert.equal(can(admin, 'case:read', { ownerProId: 'proA' }), false);
  assert.equal(can(proA, 'verification:decide'), false);
});

test('suppression de document : pro propriétaire seulement', () => {
  assert.equal(can(proA, 'document:delete', { ownerProId: 'proA' }), true);
  assert.equal(can(clientA, 'document:delete', { ownerProId: 'proA', participantUserIds: ['cliA'] }), false);
});
