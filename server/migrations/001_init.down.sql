-- PRIMA — Annulation de la migration initiale (rollback)
-- psql "$DATABASE_URL" -f migrations/001_init.down.sql
BEGIN;

DROP TABLE IF EXISTS audit_events CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS invoice_sequences CASCADE;
DROP TABLE IF EXISTS webhook_events CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS case_participants CASCADE;
DROP TABLE IF EXISTS cases CASCADE;
DROP TABLE IF EXISTS appointments CASCADE;
DROP TABLE IF EXISTS blocked_periods CASCADE;
DROP TABLE IF EXISTS availability_rules CASCADE;
DROP TABLE IF EXISTS appointment_types CASCADE;
DROP TABLE IF EXISTS verification_records CASCADE;
DROP TABLE IF EXISTS professional_profiles CASCADE;
DROP TABLE IF EXISTS memberships CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS password_reset_tokens CASCADE;
DROP TABLE IF EXISTS auth_credentials CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;

DROP TYPE IF EXISTS invoice_status;
DROP TYPE IF EXISTS subscription_status;
DROP TYPE IF EXISTS message_delivery;
DROP TYPE IF EXISTS case_status;
DROP TYPE IF EXISTS appointment_status;
DROP TYPE IF EXISTS verification_decision;
DROP TYPE IF EXISTS org_role;
DROP TYPE IF EXISTS user_status;
DROP TYPE IF EXISTS user_role;

COMMIT;
