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
- **Logique métier pure + testée** (`src/domain`, inclus dans la suite de 72 tests) :
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

## Phase B — livrée (HTTP + adaptateurs + identité) et testée
**Identité** : auth maison par défaut — condensat **scrypt** salé
(`src/auth/password.ts`), **argon2id** reste l'option de prod (adaptateur à
substituer) ; jetons de reset **aléatoires, expirants, usage unique**
(`src/auth/tokens.ts`). Un fournisseur OIDC reste branchable via la session.

**Couche HTTP** (`src/http/app.ts`, Fastify) — ordre REFUS PAR DÉFAUT :
1. Session (cookie **HttpOnly/SameSite**, `Secure` en prod, expirante,
   révocable) → l'acteur et son rôle viennent du serveur, **jamais** de localStorage.
2. **CSRF** double-submit sur les requêtes mutantes authentifiées.
3. Autorisation `can(actor, action, resource)` (`src/domain/authz`) par
   identifiant de ressource (confirmation RDV = pro propriétaire ; vérification
   = admin **+ MFA**).
4. Validation d'entrée **zod** (emails, dates, montants…).

**Adaptateurs** : `PgAppointmentRepo` (pg, transaction + `23505` → `slot_taken`),
`SqliteAppointmentRepo` (dev/test, `node:sqlite`), `StripePayment` (checkout via
fetch + `verifyWebhook`). Composition prod dans `src/composition.ts` +
`src/index.ts` (slots via `computeSlots` sur les règles réelles ; webhook
`ON CONFLICT DO NOTHING` idempotent ; vérification ≠ abonnement).

**Routes** : `/health`, `/me`, `/auth/{register,login,logout,reset/request,
reset/confirm}`, `/pros/:id/slots`, `/appointments`,
`/appointments/:id/{confirm,cancel}`, `/admin/verify`, `/billing/checkout`,
`/webhooks/stripe`. Honoraires d'avocat = **séparés** et reportés.

### Preuves exécutables (suite complète : 72 tests `node:test`, `npm test`)
- Domaine (slots/DST, autorisation A/B, facturation, signature+idempotence).
- **Auth** : hash/verify scrypt ; reset expiré/usage unique/mauvais jeton.
- **Intégration SQLite** (contraintes réelles) : **double réservation → une
  seule gagne** (FUN-02), créneau libéré re-réservable, **idempotence webhook**.
- **HTTP** (`fastify.inject`) : 401 sans session, **403 sans CSRF**,
  **403 cross-cabinet** (autorisation), **MFA admin requis**, reset **202
  uniforme**, webhook **400 signature invalide / 200 valide**.

### Reste à faire sur infra réelle (non exécutable dans le scaffold)
Exécuter les migrations sur **PostgreSQL** et rejouer les invariants sur la vraie
base ; brancher le **stockage privé** (liens signés), la **file d'emails** réelle
(reprises/idempotence), l'**enrôlement MFA** admin, les **clés Stripe test** ; et
les tests §8 restants (webhook dupliqué/hors-ordre sur Postgres, sauvegarde/
restauration). Rien n'est déployé.

## Lot 3 — dossiers, échanges, pièces, abonnement, facturation (testé)
Migration : `migrations/002_lot3.sql` (+ `002_lot3.down.sql`).

| Sujet | Livré | Preuve (tests) |
|---|---|---|
| **Messages** (FUN-03) | Note interne (pro seul) ≠ message transmis (participants) ; statut `stored → delivered/failed` ; notification email **générique, sans contenu juridique** | `messaging.test`, `http.lot3.test` (client ne voit pas la note, tiers 403, aucune notif pour une note) |
| **Pièces** (FUN-04) | Rattachées à un dossier ; dépôt participant/pro ; validation taille, type, **contenu réel** (signature binaire), nom assaini ; **quota visible** (413) ; téléchargement par **lien signé 5 min** ; suppression pro seul | `documents-visio.test`, `http.lot3.test` (falsifié 422, quota 413, lien altéré/expiré 403) |
| **Abonnement SaaS** (FUN-05) | Checkout serveur par formule (prix résolus serveur) ; webhook signé → enregistrement idempotent + application **dans une transaction** ; hors-ordre ignoré ; impayé (grâce 7 j) ; résiliation/expiration → gratuit ; `checkout.session.completed` n'active rien | `entitlements.test`, `integration.lot3.test`, `http.lot3.test` |
| **Facturation honoraires** (FUN-06) | Brouillon (sans numéro) ≠ émise ; numéro **attribué à l'émission**, compteur verrouillé, jamais réutilisé ; émise non supprimable (annulation) ; montant ≤ 0 refusé (code + CHECK base) ; cloisonnement par cabinet | `integration.lot3.test` (5 émissions concurrentes → 5 numéros consécutifs), `http.lot3.test` |
| **Téléconsultation** | **Pas de visio native** : lien d'un fournisseur externe, https uniquement, sans identifiants, hôte en liste blanche | `documents-visio.test`, `http.lot3.test` |

**Séparé et reporté** : l'encaissement des **honoraires d'avocat** (aucun modèle
contractuel ni prestataire adapté). La facturation ne fait qu'enregistrer des
factures ; elle n'encaisse rien.

**À décider par l'éditeur avant publication** : affichage HT/TTC et fiscalité
des formules ; limites et conditions par formule ; durée de grâce en impayé
(7 j par défaut) ; quotas (10 Mo/fichier, 200 Mo/cabinet par défaut) ; liste des
fournisseurs visio autorisés ; format de numérotation des factures à faire
valider (aucune conformité comptable n'est revendiquée).

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
