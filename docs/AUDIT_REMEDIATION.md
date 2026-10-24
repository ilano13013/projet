# PRIMA — Remédiation de l'audit du 24 octobre 2026

> Document de pilotage interne. Périmètre : **l'application uniquement**
> (`prima/`) et ses espaces particulier / professionnel / administrateur,
> dépôt `ilano13013/projet`. Les sites de présentation externes sont **hors
> périmètre** et ne sont pas touchés.
>
> Branche de travail dédiée : `claude/audit-remediation-oct2026`.
> Aucune modification de production, aucun déploiement, aucun paiement réel,
> aucune donnée réelle importée, aucun utilisateur contacté.

## 0. Nature de l'application (constat de cartographie)

- Application **mono-fichier** `prima/index.html` (~4 700 lignes : HTML + CSS +
  JS inline), PWA (`sw.js`, `manifest.webmanifest`), déployée en statique via
  GitHub Pages (`.github/workflows/deploy-pages.yml`).
- **Aucun serveur, aucune base de données, aucun fournisseur d'identité.**
  Toute la logique (identité, session, rôle, droit payant, données métier)
  vit dans le navigateur via `localStorage`.
- Conséquence structurelle : **aucune frontière de sécurité réelle** n'existe
  aujourd'hui. Les correctifs purement applicatifs (Lot 0) réduisent les
  risques et rétablissent l'honnêteté du prototype, mais la sécurité réelle
  (SEC-01/02/04, FUN-01/02/03/05/07) **exige le socle serveur du Lot 1**.

## 1. Revalidation des constats (lecture du code réel, 2026-10-24)

| ID | Revalidé | Emplacement (prima/index.html) | Verdict |
|----|----------|-------------------------------|---------|
| SEC-01 | ✅ | `ADMIN_EMAIL`/`ADMIN_PWD_HASH` (~1297-1299), `seedAdmin` (~1328), `sha256sync` (~1310), `loginSuccess`/session `{id}` (~1564) | Confirmé. Admin + condensat codés en dur dans le HTML public ; rôle/isAdmin lus depuis localStorage ; `sha256sync` = hash 32 bits non cryptographique ; SHA-256 non salé en secours. |
| SEC-02 | ✅ | `sendResetEmail` (~1640), `doResetPassword` (~1675) | Confirmé. Mailto puis affichage immédiat du formulaire ; réinitialisation locale **sans jeton vérifié** ; message distinct si compte inexistant → **énumération**. |
| SEC-03 | ✅ | `entries`/`prima_entries` (~2161-2186) | Confirmé. Tableau global unique, sans propriétaire, chargé au parse, jamais vidé au changement de session → carnets partagés entre comptes d'un même navigateur. |
| SEC-04 | ✅ | `cloudSaveUsers` (~1446), `getCloudBucket` (~1390), `saveUsers` (~1456), démarrage (~1490) | Confirmé. Le **tableau complet des comptes (condensats inclus)** est PUT vers un bucket **anonyme public** (jsonstorage.net / kvdb.io) à chaque sauvegarde ; `getCloudBucket` **crée automatiquement** un bucket au démarrage ; déclenché dès le splash via `syncUsersFromCloud`. Politique fournisseur et transferts déjà effectués **non vérifiés** (à revoir côté propriétaire, sans lecture ni purge sans autorisation). |
| FUN-01/02 | ✅ | `renderSlots` (~2820), `defaultSlots` (~2706), `prima_rdv` | Confirmé. Créneaux depuis `defaultSlots` codés en dur ; `horaires`/`blockedDates`/`consultationTypes` du pro **non consommés** ; réservation locale sans transaction serveur anti-double-réservation. |
| FUN-03 | ✅ | messagerie, `sendMessage` + repli mailto | Confirmé. Conversations locales, bouton « Reçu », repli mailto ; aucun échange entre deux sessions distantes. |
| FUN-04 | ✅ | `saveDocument` (~3727), `db.set` (~1304) | Confirmé. `db.set` **avale l'exception** en interne → le `catch` externe de `saveDocument` est inopérant ; en cas de quota dépassé, échec silencieux + toast « importé ✓ » trompeur. DataURL en localStorage, 2 Mo/fichier. |
| FUN-05 | ✅ | `selectAbo` (~3274) | Confirmé. `confirm("… Simulation — pas de paiement …")`, modifie le `tier` local. Droit payant **autoritaire dans localStorage**. Aucun paiement réel. |
| FUN-06 | ✅ | `saveFacture` (~4259), `deleteFacture` (~4275) | Confirmé. Numéro = `count+1` → **réutilisation** après suppression ; `deleteFacture` supprime silencieusement ; statut payé manuel ; `amount` **négatif accepté** (`!amount` ne rejette que 0/NaN). |
| FUN-07 | ✅ | config EmailJS (`EMAILJS_USER=''`), `sendBookingEmail` | Confirmé. Rappels par `setTimeout` en page ; EmailJS sans clé publique ⇒ aucun envoi serveur ; `sendBookingEmail` déclaré. |
| LEG-01 | ✅ | `showLegal` (cgu/cgv/privacy) | Confirmé. Textes avec responsable/SIRET/hébergeur/validateur à compléter ; non consultables avant inscription. |
| UX-01/02 | ✅ | `#auth-screen`, labels d'auth, cercles décoratifs | Confirmé. Labels non associés ; débordement horizontal ; champs potentiellement coupés. |
| TECH-01/02 | ✅ | `<meta viewport ... user-scalable=no>`, absence de `prefers-reduced-motion`, mono-fichier, pas de tests | Confirmé. Zoom désactivé ; pas de règle de mouvement réduit ; monolithe sans tests. |

**Note méthodologique :** ces constats sont statiques (lecture de code) et par
l'exercice des écrans en session de test locale — jamais sur la production, et
sans déclencher la fuite cloud (aucune donnée envoyée aux buckets anonymes
pendant la revalidation).

## 2. Plan d'implémentation ordonné

### Lot 0 — Sécurité & honnêteté du prototype (applicatif, sans serveur) — *en cours*
0.1 Couper par défaut les écritures cloud anonymes + supprimer la création
    automatique de bucket (SEC-04).
0.2 Supprimer l'identité admin et le condensat codés en dur (SEC-01, partiel).
0.3 Supprimer la réinitialisation locale non vérifiée + réponse uniforme
    (SEC-02).
0.4 Isoler le carnet par propriétaire, ne jamais réattribuer les anciennes
    notes (SEC-03).
0.5 Frontière démo/réel : marquer « Démonstration » toute action simulée
    (abonnement, visio, email, paiement) ; retirer les promesses non prouvées
    (FUN-05, FUN-03, FUN-07 — honnêteté).
0.6 Rendre CGU / confidentialité / mentions / contact consultables **avant**
    inscription ; remplacer les données légales inventées par des champs
    « À COMPLÉTER PAR L'ÉDITEUR » ; bloquer la publication commerciale si
    incomplet (LEG-01).
0.7 Honnêteté/validation applicative : surfacer l'échec quota (FUN-04) ;
    rejeter montants ≤ 0 et numérotation durable sans réutilisation côté
    app (FUN-06, partiel) ; distinguer brouillon/facture émise.
0.8 Accessibilité & responsive peu coûteux : autoriser le zoom,
    `prefers-reduced-motion`, associer labels/erreurs, corriger le
    débordement `#auth-screen` (UX-01/02, TECH-01).

### Lot 1 — Fondations serveur — *Phases A + B livrées (`server/`)*
Décisions prises : **hébergement UE**, **Stripe (test)**. Livré et testé
(**39 tests `node:test`, 0 échec**) : schéma relationnel + contraintes de
sécurité ; domaine (slots/DST, autorisation refus-par-défaut, numérotation
factures, idempotence webhook) ; **auth** (scrypt + jetons de reset
expirants/usage unique) ; **couche HTTP Fastify** (session/CSRF/authz/zod) ;
adaptateurs Postgres + SQLite (tests réels d'anti-double-réservation et
d'idempotence) + Stripe. Reste à exécuter sur **infra réelle** (Postgres,
stockage privé, provider email, clés Stripe test) — **non déployé**
(voir `server/README.md`).
### Lot 2 — Parcours réel inscription→RDV confirmé — *implémenté côté serveur, à exécuter sur Postgres/staging*
Routes et logique livrées (inscription/login, créneaux via `computeSlots`,
réservation transactionnelle anti-double-réservation, confirmation par le pro
propriétaire, vérification admin+MFA). Démonstration bout-en-bout avec 2 comptes
et 2 contextes navigateur = sur staging autorisé avec Postgres (non déployé ici).
### Lot 3 — Dossiers / échanges / pièces / abonnement (paiement test) — *dépend du Lot 1*
### Lot 4 — UX/accessibilité/responsive complets + modularisation + tests — *après Lot 1-3*

## 3. Registre de résolution (ID → statut → fichier → preuve → test)

Voir `docs/RESOLUTION_REGISTRY.md` (tenu à jour à chaque lot).

## 4. Décisions requises avant le Lot 1 (socle serveur)

Le Lot 1 ne peut pas être construit ni déployé sans arbitrages. Changements
préparés et révisables, **aucun déploiement**. Décisions attendues :

1. **Hébergement & région** — ✅ **décidé : UE**. (Hébergeur précis à fixer.)
2. **Fournisseur d'identité** — *à confirmer* : OIDC géré (recommandé) ou auth
   maison (argon2id + MFA admin), les deux prévus dans le schéma. MFA admin requis.
3. **Prestataire de paiement (abonnement SaaS, test)** — ✅ **décidé : Stripe (test)**.
   (Honoraires d'avocat **reportés** faute de modèle contractuel.)
4. **Entité légale** — *à fournir* : responsable de publication, SIRET,
   hébergeur réel, validateur juridique. Sans ces données, pas de publication
   commerciale (LEG-01).
5. **Ciblage éditorial** — *arbitrage à rendre* : le discours particulier cible
   « femmes/victimes ». N'empêche pas les correctifs de sécurité.

## 5. Risques résiduels & critères go/no-go

Voir `docs/RESIDUAL_RISKS.md`.

## 6. Accès / configurations manquants

Voir `docs/MISSING_ACCESS.md`.
