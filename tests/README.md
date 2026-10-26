# Tests PRIMA

Deux niveaux de vérification. Aucune donnée réelle, aucun appel réseau sortant
(le harnais échoue si l'application tente d'écrire vers un stockage cloud
anonyme — SEC-04).

## 1. Contrôle statique (sans dépendance)
Extrait le JavaScript inline de `prima/index.html` et vérifie sa syntaxe :

```bash
node tests/static-check.js
```

## 2. Harnais comportemental (Playwright + Chromium)
Vérifie les correctifs du Lot 0 en pilotant réellement l'application sur
`file://` (environnement local) :

```bash
npm i playwright          # ou réutiliser une installation Playwright existante
node tests/lot0.audit.spec.js
```

Assertions couvertes (sortie `N PASS / M FAIL`, code de sortie ≠ 0 si échec) :

- **SEC-04** — aucun appel réseau vers jsonstorage.net / kvdb.io au démarrage.
- **SEC-01** — aucun email admin codé en dur en base ; seeder de démonstration
  gardé par `isLocalEnv` (inerte en production) ; admin de démo fictif en local.
- **UX-02** — `#auth-screen` sans débordement horizontal à 360 / 390 / 768 px.
- **LEG-01** — textes légaux consultables avant inscription ; placeholders
  « À COMPLÉTER » ; bandeau « non publiable ».
- **SEC-02** — la « réinitialisation » ne change aucun mot de passe localement ;
  le formulaire de nouveau mot de passe n'est jamais affiché.
- **SEC-03** — carnets isolés par propriétaire (un compte ne voit pas le carnet
  d'un autre ; stockage par clé dédiée).
- **FUN-06** — montant ≤ 0 rejeté ; numéro de facture non réutilisé après
  suppression.
- **Lot 3** — lien visio `javascript:` / `http:` refusé (https seulement) ;
  la notification email d'un message ne contient pas son contenu.

Les tests du serveur (`server/`, 72 tests) se lancent séparément :
`cd server && npm install && npm test`.

Les contrôles non automatisés (navigateurs réels iOS/Android, lecteur d'écran,
RGAA, Lighthouse) restent **À vérifier** manuellement — aucun résultat n'est
revendiqué sans exécution.
