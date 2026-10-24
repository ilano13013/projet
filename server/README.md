# PRIMA — Socle serveur (Lot 1)

> Scaffold **révisable**, **non déployé**. Cible : TypeScript + PostgreSQL
> (hébergement UE), stockage de fichiers privé, fournisseur d'identité éprouvé,
> paiement **Stripe en mode test**. Décisions validées : UE + Stripe test.

## Ce qui est livré et PROUVÉ ici (Phase A)
- **Schéma relationnel complet** (`migrations/001_init.sql`, rollback
  `001_init.down.sql`) couvrant les 16 modèles demandés + `invoices`.
  Les contraintes portent la sécurité :
  - `ux_appt_active_slot` (index unique partiel) → **anti-double-réservation**
    (FUN-02) : deux RDV actifs ne peuvent partager le même créneau.
  - `invoice_sequences` + `UNIQUE(professional_user_id, seq|number)` →
    **numérotation durable atomique** (FUN-06).
  - `webhook_events UNIQUE(provider, provider_event_id)` → **idempotence**.
  - `CHECK (amount_cents > 0)` → **montants positifs** côté base.
  - Colonnes de **propriété/participants** sur chaque ressource privée.
- **Logique métier pure + testée** (`src/domain`, 24 tests `node:test`) :
  - `slots.ts` — créneaux depuis horaires/exceptions/durée, **fuseau
    Europe/Paris + DST** (FUN-01).
  - `invoicing.ts` — numérotation, brouillon/émise, montants (FUN-06).
  - `authz.ts` — **refus par défaut**, séparation cabinets A/B et particuliers
    A/B, admin = vérification seulement.
  - `webhooks.ts` — vérification de signature HMAC + **idempotence** (paiement).
- **Ports** (`src/ports`) : interfaces stockage privé (liens signés), file
  d'emails, paiement, dépôt RDV transactionnel, audit.

### Lancer les tests
```bash
cd server
npm install        # typescript + @types/node (pas de dépendance native)
npm test           # build + 24 tests  →  # pass 24 / # fail 0
```

### Appliquer le schéma (Postgres)
```bash
createdb prima           # ou base gérée UE
psql "$DATABASE_URL" -f migrations/001_init.sql
# rollback :
psql "$DATABASE_URL" -f migrations/001_init.down.sql
```

## Ce qui reste à câbler (Phase B — nécessite dépendances + infra)
La couche HTTP et les adaptateurs concrets ne sont pas encore écrits en code
exécutable ici car ils requièrent des dépendances (fastify, pg, stripe, argon2,
zod) et une infra (Postgres, bucket privé, clés Stripe test) non présentes dans
l'environnement de scaffold. Plan arrêté :

**Adaptateurs** (implémentent `src/ports`) : `PgRepository` (pg, transactions),
`S3PrivateStorage` (liens signés TTL court), `QueueEmail` (file + reprises +
idempotence), `StripePayment` (checkout serveur + `verifyWebhook`).

**Middlewares (ordre, refus par défaut)** :
1. Session (cookie **HttpOnly/Secure/SameSite**, expirante, révocable) →
   l'utilisateur et son rôle viennent du serveur, **jamais** de localStorage.
2. Protection **CSRF** sur les méthodes mutantes.
3. Autorisation `can(actor, action, resource)` (`src/domain/authz`) sur
   **chaque** lecture/écriture/téléchargement, par identifiant de ressource.
4. Validation d'entrée (zod) : emails, montants, **URLs visio** (schémas sûrs),
   tailles/types de fichiers.

**Routes du parcours Lot 2** :
`POST /auth/register` · `POST /auth/login` · `POST /auth/logout` ·
`POST /auth/reset/request` (jeton aléatoire, expirant, usage unique, vérifié
serveur — réponse uniforme) · `POST /auth/reset/confirm` ·
`POST /admin/verify` (MFA admin ; l'abonnement **ne** confère **pas** le statut
vérifié) · `GET /pros/:id/slots` (via `computeSlots`) ·
`POST /appointments` (via `AppointmentRepoPort.bookTransactional`) ·
`POST /appointments/:id/confirm|cancel`.

**Paiement SaaS (Stripe test)** : `POST /billing/checkout` (session serveur) ·
`POST /webhooks/stripe` (vérif signature → `webhook_events` idempotent → calcul
des droits **côté serveur**). Jamais d'activation depuis le retour navigateur.
Honoraires d'avocat = **séparés** et reportés (pas de modèle contractuel).

## Variables d'environnement
Voir `../.env.example` (modèle, sans secret). Copier en `server/.env`
(git-ignoré) avec des valeurs de **test** uniquement.

## Sauvegarde / restauration & migration
- Migrations SQL versionnées (`migrations/NNN_*.sql` + `.down.sql`).
- Sauvegarde : `pg_dump` planifié ; **restauration à tester réellement** avant
  tout pilote (critère go/no-go — `docs/RESIDUAL_RISKS.md`).

## Limites honnêtes
Aucune certification, aucun chiffrement de bout en bout, aucune conformité ne
découle de ce scaffold. Les contrôles non exécutés (charge, pentest, RGAA)
restent **À vérifier**. Rien n'est déployé.
