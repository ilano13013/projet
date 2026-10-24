/**
 * Jetons de réinitialisation de mot de passe (SEC-02).
 * Aléatoire, EXPIRANT, à USAGE UNIQUE, lié au compte, vérifié côté serveur.
 * On ne stocke JAMAIS le jeton en clair, seulement son condensat.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const DEFAULT_TTL_MINUTES = 30;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Génère un jeton à transmettre par email + son condensat à stocker. */
export function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export interface ResetRecord {
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

/** Vrai seulement si le jeton correspond, n'est pas expiré et jamais utilisé. */
export function isResetTokenValid(rec: ResetRecord | null | undefined, presentedToken: string, now: Date): boolean {
  if (!rec || !presentedToken) return false;
  if (rec.usedAt) return false;                                  // usage unique
  if (now.getTime() > rec.expiresAt.getTime()) return false;     // expiré
  const a = Buffer.from(rec.tokenHash, 'utf8');
  const b = Buffer.from(hashToken(presentedToken), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
