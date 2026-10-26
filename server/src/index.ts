/**
 * Point d'entrée serveur (production). Non exécuté dans l'environnement de
 * scaffold (nécessite DATABASE_URL + clés Stripe test). Type-vérifié.
 */
import { Pool } from 'pg';
import { buildApp } from './http/app';
import { createServices } from './composition';
import { StripePayment } from './adapters/stripe';
import type { EmailQueuePort } from './ports';
import { DiskPrivateStorage } from './adapters/diskStorage';

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

  // Stockage privé à liens signés temporaires (disque : dev/staging ; bucket objet privé en production).
  const storage = new DiskPrivateStorage(env('FILE_STORAGE_DIR'), env('FILE_SIGNING_SECRET'));
  const visioHosts = (process.env.VISIO_ALLOWED_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean);

  const services = createServices(pool, pay, email,
    { baseUrl: env('APP_BASE_URL', 'http://localhost:3000'), prices: { premium: env('PRICE_PREMIUM'), expert: env('PRICE_EXPERT') } },
    { storage, files: { verify: (k, e, sg) => storage.verify(k, e, sg), read: (k) => storage.read(k) },
      visioAllowedHosts: visioHosts.length ? visioHosts : undefined });
  const app = buildApp(services, { cookieSecure: env('NODE_ENV', 'development') === 'production' });

  const port = Number(env('PORT', '3000'));
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`PRIMA server écoute sur :${port}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
