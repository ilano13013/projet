/**
 * Adaptateur paiement Stripe (MODE TEST). Sans SDK (appels API via fetch).
 * - createCheckout : crée une session d'abonnement SERVEUR.
 * - verifyWebhook  : vérifie la signature (fonction pure testée du domaine).
 * On ne traite JAMAIS un abonnement à partir du retour navigateur : seuls les
 * webhooks SIGNÉS et IDEMPOTENTS font autorité (droits calculés côté serveur).
 */
import type { PaymentPort, CheckoutSession } from '../ports';
import { verifyStripeSignature } from '../domain/webhooks';

export class StripePayment implements PaymentPort {
  constructor(private secretKey: string, private webhookSecret: string) {}

  async createCheckout(input: { plan: string; customerRef: string; successUrl: string; cancelUrl: string }): Promise<CheckoutSession> {
    const body = new URLSearchParams({
      mode: 'subscription',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.customerRef,
      'subscription_data[metadata][pro_user_id]': input.customerRef,
      'line_items[0][price]': input.plan,      // identifiant de prix Stripe (test), résolu côté serveur
      'line_items[0][quantity]': '1',
    });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error('stripe checkout failed: ' + res.status);
    const data = (await res.json()) as { id: string; url: string };
    return { url: data.url, providerSessionId: data.id };
  }

  verifyWebhook(payload: string, signature: string): boolean {
    return verifyStripeSignature(payload, signature, this.webhookSecret);
  }
}
