import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { generateResetToken, isResetTokenValid, DEFAULT_TTL_MINUTES } from '../src/auth/tokens';

test('mot de passe : hash salé puis vérification', () => {
  const h1 = hashPassword('correct horse battery staple');
  const h2 = hashPassword('correct horse battery staple');
  assert.ok(h1.startsWith('scrypt$'));
  assert.notEqual(h1, h2); // sel différent
  assert.equal(verifyPassword('correct horse battery staple', h1), true);
  assert.equal(verifyPassword('mauvais mot de passe', h1), false);
  assert.equal(verifyPassword('x', 'format$invalide'), false);
});

test('jeton de reset : valide, mauvais jeton, expiré, usage unique', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  const { token, tokenHash } = generateResetToken();
  const rec = { tokenHash, expiresAt: new Date(now.getTime() + DEFAULT_TTL_MINUTES * 60000), usedAt: null as Date | null };
  assert.equal(isResetTokenValid(rec, token, now), true);
  assert.equal(isResetTokenValid(rec, 'un-autre-jeton', now), false);
  assert.equal(isResetTokenValid(rec, token, new Date(now.getTime() + 60 * 60000)), false); // expiré
  assert.equal(isResetTokenValid({ ...rec, usedAt: now }, token, now), false);              // déjà utilisé
  assert.equal(isResetTokenValid(null, token, now), false);
});
