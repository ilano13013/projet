/**
 * Droits d'abonnement SaaS (Lot 3) — calculés CÔTÉ SERVEUR uniquement.
 * Les niveaux gratuit / premium (49 €) / expert (89 €) sont l'hypothèse
 * existante ; aucune mention HT/TTC n'est inventée ici (décision éditeur).
 *
 * Source de vérité : les événements webhook SIGNÉS (jamais le retour navigateur).
 * - Idempotence : assurée en base (webhook_events) avant d'appeler applyEvent.
 * - Hors-ordre : un événement plus ancien que le dernier appliqué est ignoré.
 * - Impayé : délai de grâce, puis retour au gratuit.
 * - Résiliation / expiration de période : retour au gratuit.
 */

export type Plan = 'gratuit' | 'premium' | 'expert';
export type SubStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';

export interface SubState {
  plan: Plan;
  status: SubStatus;
  currentPeriodEnd: Date | null;
  lastEventAt: number | null;      // horodatage (s) du dernier événement appliqué
}

export const DEFAULT_GRACE_DAYS = 7;

/** Niveau effectif à l'instant `now`. */
export function effectiveTier(sub: SubState | null | undefined, now: Date, graceDays = DEFAULT_GRACE_DAYS): Plan {
  if (!sub || sub.plan === 'gratuit') return 'gratuit';
  const end = sub.currentPeriodEnd ? sub.currentPeriodEnd.getTime() : null;
  const graceEnd = end !== null ? end + graceDays * 86400_000 : null;
  switch (sub.status) {
    case 'active':
    case 'trialing':
      // Période échue sans renouvellement confirmé : on tolère la grâce, puis expiration.
      if (graceEnd !== null && now.getTime() > graceEnd) return 'gratuit';
      return sub.plan;
    case 'past_due':
      if (graceEnd !== null && now.getTime() <= graceEnd) return sub.plan;
      return 'gratuit';
    default:
      return 'gratuit';            // canceled, incomplete
  }
}

/** Événement Stripe minimal (données déjà vérifiées par signature). */
export interface StripeEvt {
  id: string;
  type: string;
  created: number;                 // secondes
  data: { object: Record<string, unknown> };
}

function mapStatus(s: unknown): SubStatus {
  switch (s) {
    case 'active': return 'active';
    case 'trialing': return 'trialing';
    case 'past_due':
    case 'unpaid': return 'past_due';
    case 'incomplete': return 'incomplete';
    default: return 'canceled';    // canceled, incomplete_expired, inconnu → prudence
  }
}

export type ApplyResult =
  | { applied: true; next: SubState }
  | { applied: false; reason: 'out_of_order' | 'ignored' | 'unknown_price' };

/**
 * Réducteur pur : applique un événement à l'état d'abonnement.
 * `priceToPlan` traduit un identifiant de prix Stripe en niveau (config serveur).
 */
export function applyEvent(prev: SubState | null, evt: StripeEvt, priceToPlan: (priceId: string) => Plan | null): ApplyResult {
  if (prev && prev.lastEventAt !== null && evt.created < prev.lastEventAt) {
    return { applied: false, reason: 'out_of_order' };
  }
  const obj = evt.data.object as {
    status?: unknown; current_period_end?: number;
    items?: { data?: Array<{ price?: { id?: string } }> };
  };
  const base: SubState = prev ?? { plan: 'gratuit', status: 'incomplete', currentPeriodEnd: null, lastEventAt: null };

  switch (evt.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const priceId = obj.items?.data?.[0]?.price?.id;
      const plan = priceId ? priceToPlan(priceId) : null;
      if (!plan) return { applied: false, reason: 'unknown_price' };
      return { applied: true, next: {
        plan,
        status: mapStatus(obj.status),
        currentPeriodEnd: typeof obj.current_period_end === 'number' ? new Date(obj.current_period_end * 1000) : base.currentPeriodEnd,
        lastEventAt: evt.created,
      } };
    }
    case 'customer.subscription.deleted':
      return { applied: true, next: { ...base, status: 'canceled', lastEventAt: evt.created } };
    case 'invoice.payment_failed':
      return { applied: true, next: { ...base, status: base.plan === 'gratuit' ? base.status : 'past_due', lastEventAt: evt.created } };
    default:
      // checkout.session.completed n'active RIEN : seul l'état d'abonnement signé fait foi.
      return { applied: false, reason: 'ignored' };
  }
}
