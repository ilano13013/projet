-- PRIMA — Schéma initial (cible PostgreSQL, hébergement UE)
-- Lot 1. Toutes les ressources privées ont un propriétaire/cabinet et des
-- règles d'accès explicites. Les contraintes ci-dessous portent une partie de
-- la sécurité (refus par défaut applicatif + garanties base).
--
-- Appliquer : psql "$DATABASE_URL" -f migrations/001_init.sql
-- Annuler  : psql "$DATABASE_URL" -f migrations/001_init.down.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid

-- ───────────────────────── Identité & organisations ─────────────────────────
CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE user_role AS ENUM ('particulier','professionnel','admin');
CREATE TYPE user_status AS ENUM ('active','pending','suspended');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  role          user_role NOT NULL,
  status        user_status NOT NULL DEFAULT 'active',
  oidc_subject  text UNIQUE,                 -- si fournisseur d'identité OIDC
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Identifiants locaux (si auth maison) — condensat FORT (argon2id), jamais en clair.
CREATE TABLE auth_credentials (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,               -- argon2id (sel + paramètres inclus)
  mfa_enabled   boolean NOT NULL DEFAULT false,
  mfa_secret    text,                        -- chiffré au repos côté serveur
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Jetons de réinitialisation : aléatoires, expirants, usage unique, vérifiés serveur (SEC-02).
CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,                 -- on ne stocke que le condensat du jeton
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_reset_token_hash ON password_reset_tokens(token_hash);

-- Sessions serveur (révocables, expirantes) — le rôle/droit payant n'est JAMAIS
-- stocké côté client comme autorité (SEC-01/FUN-05).
CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX ix_sessions_user ON sessions(user_id);

CREATE TYPE org_role AS ENUM ('owner','member');
CREATE TABLE memberships (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_in_org      org_role NOT NULL DEFAULT 'member',
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);

-- ───────────────────────── Profils & vérification ───────────────────────────
CREATE TABLE professional_profiles (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  cabinet        text,
  departement    text,
  specialites    text,
  siret          text,
  barreau        text,
  bio            text,
  photo_url      text,
  -- Statut de visibilité annuaire : conséquence de la vérification, PAS de l'abonnement.
  verified       boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE verification_decision AS ENUM ('pending','approved','rejected');
CREATE TABLE verification_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision              verification_decision NOT NULL DEFAULT 'pending',
  decided_by            uuid REFERENCES users(id),  -- admin
  evidence              text,                        -- référence de preuve (accès restreint)
  note                  text,
  decided_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_verif_pro ON verification_records(professional_user_id);

-- ───────────────────────── Disponibilités & RDV ─────────────────────────────
CREATE TABLE appointment_types (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  duration_minutes      int  NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 480),
  price_cents           int  NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  mode                  text NOT NULL DEFAULT 'cabinet' CHECK (mode IN ('cabinet','visio')),
  active                boolean NOT NULL DEFAULT true
);

CREATE TABLE availability_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday               int  NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = lundi
  start_minute          int  NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute            int  NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  timezone              text NOT NULL DEFAULT 'Europe/Paris',
  active                boolean NOT NULL DEFAULT true,
  CHECK (end_minute > start_minute)
);

CREATE TABLE blocked_periods (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_at              timestamptz NOT NULL,
  end_at                timestamptz NOT NULL,
  reason                text,
  CHECK (end_at > start_at)
);

CREATE TYPE appointment_status AS ENUM ('pending','confirmed','cancelled','completed');
CREATE TABLE appointments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  appointment_type_id   uuid REFERENCES appointment_types(id) ON DELETE SET NULL,
  start_at              timestamptz NOT NULL,
  end_at                timestamptz NOT NULL,
  status                appointment_status NOT NULL DEFAULT 'pending',
  motif                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
-- FUN-02 : anti-double-réservation. Deux RDV ACTIFS ne peuvent pas partager le
-- même créneau de départ pour un même professionnel (contrainte base).
CREATE UNIQUE INDEX ux_appt_active_slot
  ON appointments(professional_user_id, start_at)
  WHERE status IN ('pending','confirmed');
CREATE INDEX ix_appt_pro_time ON appointments(professional_user_id, start_at);
CREATE INDEX ix_appt_client ON appointments(client_user_id);

-- ───────────────────────── Dossiers / échanges / pièces ─────────────────────
CREATE TYPE case_status AS ENUM ('ouvert','en_cours','en_attente','clos');
CREATE TABLE cases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id       uuid REFERENCES organizations(id) ON DELETE SET NULL,
  client_user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  ref                   text NOT NULL,
  title                 text NOT NULL,
  type                  text,
  status                case_status NOT NULL DEFAULT 'ouvert',
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (professional_user_id, ref)
);

-- Qui a accès à un dossier (autorisation explicite pour messages/documents).
CREATE TABLE case_participants (
  case_id     uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'participant',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, user_id)
);

CREATE TYPE message_delivery AS ENUM ('stored','delivered','failed');
CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  sender_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            text NOT NULL,
  internal_note   boolean NOT NULL DEFAULT false,  -- distingue note interne / message transmis (FUN-03)
  delivery_status message_delivery NOT NULL DEFAULT 'stored',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_messages_case ON messages(case_id, created_at);

CREATE TABLE documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid REFERENCES cases(id) ON DELETE CASCADE,
  owner_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key     text NOT NULL,            -- clé en stockage PRIVÉ (liens signés temporaires)
  filename        text NOT NULL,
  mime            text,
  size_bytes      bigint NOT NULL CHECK (size_bytes >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_documents_case ON documents(case_id);

-- ───────────────────────── Abonnement SaaS (Stripe test) ────────────────────
CREATE TYPE subscription_status AS ENUM ('trialing','active','past_due','canceled','incomplete');
CREATE TABLE subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid REFERENCES organizations(id) ON DELETE CASCADE,
  professional_user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  provider                 text NOT NULL DEFAULT 'stripe',
  provider_customer_id     text,
  provider_subscription_id text UNIQUE,
  plan                     text NOT NULL,          -- gratuit / premium / expert
  status                   subscription_status NOT NULL DEFAULT 'incomplete',
  current_period_end       timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (organization_id IS NOT NULL OR professional_user_id IS NOT NULL)
);

-- Idempotence webhook : un événement provider n'est traité qu'une fois (FUN sécurité paiement).
CREATE TABLE webhook_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           text NOT NULL,
  provider_event_id  text NOT NULL,
  type               text NOT NULL,
  payload            jsonb NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz,
  status             text NOT NULL DEFAULT 'received',
  UNIQUE (provider, provider_event_id)
);

-- ───────────────────────── Facturation (honoraires — séparé du SaaS) ─────────
-- Compteur atomique par professionnel : numéros durables, sans réutilisation (FUN-06).
CREATE TABLE invoice_sequences (
  professional_user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seq             int NOT NULL DEFAULT 0
);

CREATE TYPE invoice_status AS ENUM ('draft','issued','paid','cancelled');
CREATE TABLE invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  case_id               uuid REFERENCES cases(id) ON DELETE SET NULL,
  seq                   int,                     -- attribué à l'émission (draft = NULL)
  number                text,                    -- ex. F-2026-000123, attribué à l'émission
  status                invoice_status NOT NULL DEFAULT 'draft',
  amount_cents          int NOT NULL CHECK (amount_cents > 0),  -- FUN-06 : montant strictement positif
  currency              text NOT NULL DEFAULT 'EUR',
  service               text,
  issued_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (professional_user_id, seq),
  UNIQUE (professional_user_id, number)
);
CREATE INDEX ix_invoices_pro ON invoices(professional_user_id, created_at);

-- ───────────────────────── Journal d'audit ──────────────────────────────────
-- Utile SANS contenu d'affaire, mot de passe, jeton ni pièce sensible.
CREATE TABLE audit_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  action         text NOT NULL,
  resource_type  text,
  resource_id    text,
  metadata       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_actor ON audit_events(actor_user_id, created_at);

COMMIT;
