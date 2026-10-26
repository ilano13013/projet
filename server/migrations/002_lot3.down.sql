-- Rollback de la migration 002
BEGIN;
ALTER TABLE documents ALTER COLUMN case_id DROP NOT NULL;
ALTER TABLE professional_profiles DROP COLUMN IF EXISTS teleconsult_url;
DROP INDEX IF EXISTS ux_subscriptions_pro;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS last_event_at;
COMMIT;
