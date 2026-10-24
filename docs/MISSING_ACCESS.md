# PRIMA — Accès & configurations manquants (pour aller au-delà du Lot 0)

Aucun secret n'est stocké dans le dépôt. Les éléments ci-dessous sont requis
du propriétaire pour les lots serveur ; ils ne bloquent pas le Lot 0.

## Décisions (voir docs/AUDIT_REMEDIATION.md §4)
- [ ] Hébergeur + région (serveur, base relationnelle, stockage fichiers privé).
- [ ] Fournisseur d'identité (OIDC géré recommandé) + politique MFA.
- [ ] Prestataire de paiement SaaS en **mode test** (clés de test fournies par le propriétaire).
- [ ] Entité légale : responsable de publication, SIRET, hébergeur réel, validateur juridique.

## Secrets / configs à fournir (hors dépôt, via variables d'environnement)
- [ ] `DATABASE_URL` (base relationnelle transactionnelle).
- [ ] Clés du fournisseur d'identité (client id/secret, issuer).
- [ ] Clés **de test** du prestataire de paiement + secret de signature webhook.
- [ ] Fournisseur d'email transactionnel (clé API) pour la file serveur.
- [ ] Stockage fichiers privé (bucket privé + clés), politique de liens temporaires.

## Revue de sécurité à la charge du propriétaire
- [ ] **SEC-04** : revoir les données éventuellement déjà transmises aux buckets
      anonymes (jsonstorage.net / kvdb.io) par les versions précédentes.
      **Ne pas lire ni purger sans autorisation explicite.** Prévoir rotation
      des éventuels secrets exposés.
- [ ] **SEC-01** : révoquer / faire tourner tout identifiant admin ayant pu
      servir ailleurs (le condensat était public dans le code déployé).
