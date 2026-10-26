/**
 * Orchestration du paiement SaaS (Lot 3). Un événement Stripe VÉRIFIÉ est :
 *   1. enregistré une seule fois (idempotence, unicité en base),
 *   2. rattaché au professionnel (metadata.pro_user_id / client_reference_id),
 *   3. appliqué à l'état d'abonnement (rejet hors-ordre),
 *   4. persisté. Les droits sont ensuite calculés par effectiveTier().
 * En production, 1 et 4 s'exécutent dans la MÊME transaction (cf. composition).
 */
import { applyEvent, type Plan, type StripeEvt } from '../domain/entitlements';
import type { SubscriptionRepoPort } from '../ports';

export type ProcessOutcome = 'duplicate' | 'applied' | 'ignored' | 'out_of_order' | 'unknown_price' | 'no_pro';

export function proIdOfEvent(evt: StripeEvt): string | null {
  const o = evt.data.object as { metadata?: Record<string, string>; client_reference_id?: string };
  return (o.metadata && o.metadata.pro_user_id) || o.client_reference_id || null;
}

export async function processStripeEvent(
  evt: StripeEvt,
  deps: {
    recordOnce(evt: StripeEvt): Promise<boolean>;
    subs: SubscriptionRepoPort;
    priceToPlan(priceId: string): Plan | null;
  },
): Promise<ProcessOutcome> {
  if (!(await deps.recordOnce(evt))) return 'duplicate';
  const proId = proIdOfEvent(evt);
  if (!proId) return 'no_pro';
  const prev = await deps.subs.get(proId);
  const r = applyEvent(prev, evt, deps.priceToPlan);
  if (!r.applied) return r.reason;
  await deps.subs.save(proId, r.next);
  return 'applied';
}
