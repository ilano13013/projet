-- PRIMA — Migration 002 (Lot 3) : abonnements robustes, visio, pièces rattachées.
-- psql "$DATABASE_URL" -f migrations/002_lot3.sql
BEGIN;

-- Horodatage du dernier événement Stripe appliqué → rejet des événements hors-ordre.
ALTER TABLE subscriptions ADD COLUMN last_event_at bigint;
-- Un abonnement par professionnel (upsert depuis les webhooks).
CREATE UNIQUE INDEX ux_subscriptions_pro ON subscriptions(professional_user_id)
  WHERE professional_user_id IS NOT NULL;

-- Lien de visio d'un fournisseur EXTERNE (validé : https + hôte autorisé).
ALTER TABLE professional_profiles ADD COLUMN teleconsult_url text;

-- Chaque pièce est rattachée à un dossier (et donc à ses participants).
-- Système neuf : aucune donnée existante à migrer.
ALTER TABLE documents ALTER COLUMN case_id SET NOT NULL;

COMMIT;
