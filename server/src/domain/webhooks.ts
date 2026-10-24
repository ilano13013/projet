/**
 * Webhooks de paiement (Stripe, mode test) — vérification de signature et
 * idempotence. On ne fait JAMAIS confiance au retour navigateur : les droits
 * sont calculés à partir d'événements webhook signés et traités une seule fois.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Vérifie une signature Stripe (en-tête `Stripe-Signature`), sans dépendance.
 * Format : `t=<timestamp>,v1=<hmacSHA256(hex)>`. HMAC sur `${t}.${payload}`.
 */
export function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  opts: { toleranceSec?: number; nowSec?: number } = {},
): boolean {
  if (!payload || !signatureHeader || !secret) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map(kv => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;

  const tolerance = opts.toleranceSec ?? 300;
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > tolerance) return false;      // anti-rejeu hors fenêtre

  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Idempotence : un événement n'est traité que si son id n'a pas déjà été vu.
 * En base, l'unicité (provider, provider_event_id) garantit l'atomicité ;
 * cette fonction pure décrit la décision.
 */
export function shouldProcessEvent(eventId: string, seen: Set<string> | ReadonlyArray<string>): boolean {
  if (!eventId) return false;
  if (seen instanceof Set) return !seen.has(eventId);
  return !seen.includes(eventId);
}
