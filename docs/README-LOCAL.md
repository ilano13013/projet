# PRIMA — Exécution locale & démonstration

Application mono-fichier statique (`prima/index.html`) + PWA. Aucune
installation serveur n'est requise pour la démonstration.

## Lancer en local
Option simple (PWA/service worker actifs) — servir le dossier :
```bash
cd prima
python3 -m http.server 8000
# ouvrir http://localhost:8000/
```
Option fichier direct : ouvrir `prima/index.html` dans le navigateur
(`file://`). Les deux sont considérés comme environnement **local**.

## Comptes de démonstration (LOCAL UNIQUEMENT)
Créés automatiquement au premier lancement **en local** (hostname `localhost`,
`127.0.0.1` ou `file://`) s'il n'existe aucun compte. **Inertes en production
déployée** (aucun admin n'est créé sur le site public).

| Rôle | Email | Mot de passe |
|------|-------|--------------|
| Administrateur (démo) | `admin@demo.local` | `demo1234` |
| Professionnel (démo, Expert, vérifié) | `pro@demo.local` | `demo1234` |
| Particulier (démo) | `particulier@demo.local` | `demo1234` |

Ces identifiants sont **fictifs** et ne doivent jamais servir en production.
L'accès administrateur réel sera délivré par le serveur (Lot 1).

## Ce qui est volontairement désactivé / simulé
- **Synchronisation cloud : coupée** (`CLOUD_SYNC_ENABLED=false`). Aucune
  donnée n'est envoyée en ligne. Ne pas réactiver sans backend authentifié.
- **Abonnement, téléconsultation, emails** : démonstration uniquement, non
  opérationnels (voir bandeaux « démonstration »).
- **Réinitialisation de mot de passe** : indisponible (nécessite un jeton
  serveur, Lot 1).

## Tests
Voir `tests/README.md` :
```bash
node tests/static-check.js          # syntaxe (sans dépendance)
npm i playwright && node tests/lot0.audit.spec.js   # comportement Lot 0
```

## Réinitialiser l'état local
Vider le `localStorage` du site dans les outils développeur, ou lancer en
navigation privée.
