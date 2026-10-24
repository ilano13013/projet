/**
 * Hachage de mot de passe — KDF intégré à Node (scrypt), salé, mémoire-dur.
 * Pas de dépendance native. argon2id reste l'option de production préférée :
 * remplacer hashPassword/verifyPassword par un adaptateur argon2id le cas échéant.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384, R = 8, P = 1, KEYLEN = 64;

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = +parts[1], r = +parts[2], p = +parts[3];
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    const dk = scryptSync(pw, salt, expected.length, { N: n, r, p, maxmem: 64 * 1024 * 1024 });
    return dk.length === expected.length && timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}
