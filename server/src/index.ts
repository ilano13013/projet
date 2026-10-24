/**
 * Point d'entrée serveur (production). Non exécuté dans l'environnement de
 * scaffold (nécessite DATABASE_URL + clés Stripe test). Type-vérifié.
 */
import { Pool } from 'pg';
import { buildApp } from './http/app';
import { createServices } from './composition';
import { StripePayment } from './adapters/stripe';
import type { EmailQueuePort } from './ports';

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

async function main() {
  const pool = new Pool({ connectionString: env('DATABASE_URL') });
  const pay = new StripePayment(env('PAYMENT_TEST_SECRET_KEY'), env('PAYMENT_WEBHOOK_SIGNING_SECRET'));

  // Adaptateur email réel (file + reprises) à brancher ; ici une implémentation
  // minimale qui journalise la mise en file sans contenu sensible.
  const email: EmailQueuePort = {
    async enqueue(job) { console.log('[email:enqueue]', { to: job.to, subject: job.subject, key: job.idempotencyKey }); },
  };

  const services = createServices(pool, pay, email, env('APP_BASE_URL', 'http://localhost:3000'));
  const app = buildApp(services, { cookieSecure: env('NODE_ENV', 'development') === 'production' });

  const port = Number(env('PORT', '3000'));
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`PRIMA server écoute sur :${port}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
