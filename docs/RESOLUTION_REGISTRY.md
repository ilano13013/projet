# PRIMA — Registre de résolution par ID

Statuts : `À FAIRE` · `EN COURS` · `APPLIQUÉ (app)` · `MITIGÉ` · `REQUIERT SERVEUR` · `REQUIERT DÉCISION`

Preuves Lot 0 : `tests/lot0.audit.spec.js` (17 PASS / 0 FAIL, 2026-10-24) et
`tests/static-check.js` (syntaxe JS OK). Voir `tests/README.md`.

| ID | Priorité | Statut | Fichier(s) | Correctif appliqué | Preuve / Test |
|----|----------|--------|-----------|-----------|---------------|
| SEC-01 | P0 | APPLIQUÉ (app) + SERVEUR (testé) · exécuter sur infra | prima/index.html, server/ | App : admin codé en dur supprimé. Serveur : rôle/droits depuis session serveur (jamais localStorage), autorisation refus-par-défaut, admin+MFA ; condensat scrypt salé. | App test SEC-01 (4) ; server authz/http/auth tests |
| SEC-02 | P0 | APPLIQUÉ (app) + SERVEUR (testé) · exécuter sur infra | prima/index.html, server/ | App : reset local sans jeton supprimé, réponse uniforme. Serveur : jeton aléatoire, expirant, usage unique, vérifié ; révocation des sessions ; réponse uniforme 202. | App test SEC-02 (2) ; server test auth (tokens) + http (reset 202) |
| SEC-03 | P0 | APPLIQUÉ (app) | prima/index.html | Carnet scoppé par propriétaire (`prima_carnet__<id>`), chargé au login, vidé à la déconnexion ; notes orphelines jamais réattribuées (migration explicite). | Test SEC-03 (2 assertions) |
| SEC-04 | P0 | APPLIQUÉ (app) | prima/index.html | `CLOUD_SYNC_ENABLED=false` ; suppression de la création automatique de bucket ; toutes les écritures/lectures cloud gardées. Aucun appel réseau par défaut. | Test SEC-04 (0 appel cloud) |
| FUN-01 | P1 | IMPLÉMENTÉ (serveur, testé) · exécuter sur Postgres | server/src/domain/slots.ts, composition.ts | Créneaux depuis horaires/exceptions/durée, fuseau Europe/Paris + DST. | server test slots (7) |
| FUN-02 | P1 | IMPLÉMENTÉ (serveur, testé) · exécuter sur Postgres | server/migrations, adapters/pg.ts, adapters/sqlite.ts | Index unique partiel + transaction ; deux réservations concurrentes → une seule. | server test intégration SQLite (double booking) |
| FUN-03 | P1 | IMPLÉMENTÉ (serveur, testé) · exécuter sur Postgres ; app = démo honnête | server/src/domain/messaging.ts, http/lot3.ts, adapters/pgLot3.ts ; prima/index.html | Messages visibles aux participants autorisés ; note interne ≠ transmis ; statut stored/delivered/failed ; notification SANS contenu (serveur et app). Échange entre deux sessions = serveur. | messaging.test, http.lot3.test ; app Lot 3 (notif sans contenu) |
| FUN-04 | P1 | APPLIQUÉ (app) + IMPLÉMENTÉ (serveur, testé) | prima/index.html ; server/src/domain/documents.ts, adapters/diskStorage.ts, http/lot3.ts | App : quota surfacé. Serveur : pièce rattachée au dossier, validation taille/type/contenu réel/nom, quota 413 explicite, téléchargement par lien signé temporaire, suppression pro seul. | documents-visio.test, http.lot3.test (falsifié/quota/lien altéré/expiré) |
| FUN-05 | P1 | APPLIQUÉ (app, démo) + IMPLÉMENTÉ (serveur, Stripe test, testé) | prima/index.html ; server/src/domain/entitlements.ts, services/billing.ts, composition.ts | Checkout serveur ; webhook signé + idempotent + transactionnel ; hors-ordre ignoré ; impayé/résiliation/expiration ; aucun droit depuis le retour navigateur. HT/TTC et conditions = décision éditeur. | entitlements.test, integration.lot3.test, http.lot3.test |
| FUN-06 | P1 | APPLIQUÉ (app) + IMPLÉMENTÉ (serveur, testé) | prima/index.html ; server/adapters/sqlite.ts, pgLot3.ts, migrations | Brouillon ≠ émise ; numéro attribué à l'émission par compteur verrouillé (jamais réutilisé) ; émise non supprimable (annulation) ; montant ≤ 0 refusé (code + CHECK). Conformité comptable NON revendiquée (validation à faire). | integration.lot3.test (5 émissions concurrentes), http.lot3.test ; app FUN-06 |
| FUN-07 | P1 | SCAFFOLD (serveur) · provider à brancher | server/src/ports (EmailQueuePort), composition.ts | File d'emails idempotente (interface + mise en file à la demande de reset) ; provider réel + reprises = suite. | — |
| LEG-01 | P1 | APPLIQUÉ (app) · textes à compléter | prima/index.html | Modale légale accessible AVANT inscription ; données inventées remplacées par « À COMPLÉTER » ; bandeau « non publiable » ; claim sécurité SHA-256 corrigé. Complétion/validation = propriétaire. | Test LEG-01 (3 assertions) |
| UX-01 | P2 | APPLIQUÉ (app) | prima/index.html | 15 labels d'auth associés (`for=`) ; erreurs `aria-live` ; focus visible global. | Vérif statique (15 `for=`) |
| UX-02 | P2 | APPLIQUÉ (app) | prima/index.html | Cercles décoratifs encapsulés dans `.auth-bg` (clip) ; plus de débordement. | Test UX-02 (360/390/768) |
| TECH-01 | P2 | APPLIQUÉ (app) | prima/index.html | `user-scalable=no` retiré (zoom autorisé) ; `prefers-reduced-motion`. | Vérif statique |
| TECH-02 | P2 | MITIGÉ · modularisation = Lot 4 | tests/ | Harnais de tests + contrôle statique ajoutés. Modularisation du monolithe = Lot 4. | tests/ exécutés |

## Lot 3 — ajouts
- **Téléconsultation (hors ID)** : app — lien `javascript:`/`http:` neutralisé
  avant injection dans un `href` (faille XSS corrigée) ; serveur — https +
  liste blanche d'hôtes + pas d'identifiants. Pas de visio native annoncée.
- **Encaissement des honoraires** : séparé de l'abonnement SaaS et **reporté**.
- Preuves : serveur **72/72** (`cd server && npm test`), app **21/21**
  (`tests/lot0.audit.spec.js`).

## Synthèse Lot 0
- P0 (SEC-01/02/03/04) : traités au niveau applicatif ; la **sécurité réelle**
  des points nécessitant une frontière serveur (01/02) arrive au Lot 1.
- P1 applicatifs (FUN-04/05/06, LEG-01) : traités. FUN-01/02/03/07 =
  REQUIERT SERVEUR (Lots 2-3).
- P2 (UX-01/02, TECH-01/02) : traités (TECH-02 partiellement : tests oui,
  modularisation Lot 4).
