# PRIMA — Registre de résolution par ID

Statuts : `À FAIRE` · `EN COURS` · `APPLIQUÉ (app)` · `MITIGÉ` · `REQUIERT SERVEUR` · `REQUIERT DÉCISION`

| ID | Priorité | Statut | Fichier(s) | Correctif | Preuve / Test |
|----|----------|--------|-----------|-----------|---------------|
| SEC-01 | P0 | EN COURS | prima/index.html | Suppression admin + condensat codés en dur ; arrêt de la confiance au rôle localStorage (frontière réelle = Lot 1) | Test : `seedAdmin` absent ; aucun compte admin auto ; cf. §tests |
| SEC-02 | P0 | EN COURS | prima/index.html | Suppression du reset local sans jeton ; réponse uniforme anti-énumération ; vrai reset = Lot 1 | Test : reset ne change plus de mot de passe localement ; message uniforme |
| SEC-03 | P0 | EN COURS | prima/index.html | Carnet scoppé par propriétaire ; rechargé au login ; anciennes notes non réattribuées | Test : 2 comptes, carnets isolés ; notes orphelines invisibles |
| SEC-04 | P0 | EN COURS | prima/index.html | Écritures cloud anonymes OFF par défaut ; suppression création auto de bucket | Test : aucun appel réseau cloud au démarrage/sauvegarde (par défaut) |
| FUN-01 | P1 | REQUIERT SERVEUR | prima/index.html | Créneaux depuis horaires/exceptions/durée/fuseau + anti-chevauchement transactionnel | Lot 2 |
| FUN-02 | P1 | REQUIERT SERVEUR | prima/index.html | Contrainte base anti-double-réservation concurrente | Lot 2 |
| FUN-03 | P1 | REQUIERT SERVEUR | prima/index.html | Messages réellement visibles aux 2 participants ; distinguer note/transmis/échec | Lot 3 ; honnêteté app : Lot 0.5 |
| FUN-04 | P1 | EN COURS | prima/index.html | Surfaçage réel de l'échec quota (db.set ne doit plus masquer) | Test : quota plein → erreur visible, pas de faux succès |
| FUN-05 | P1 | EN COURS | prima/index.html | Marquage « Démonstration » ; droit payant non autoritaire en local (réel = Lot 3) | Test : libellé démo visible ; cf. Lot 3 pour paiement |
| FUN-06 | P1 | EN COURS | prima/index.html | Rejet montant ≤ 0 ; numérotation durable sans réutilisation ; brouillon vs émise ; pas de suppression silencieuse d'une émise | Test : montant négatif rejeté ; numéro non réutilisé après suppression |
| FUN-07 | P1 | REQUIERT SERVEUR | prima/index.html | Emails/rappels via file serveur idempotente | Lot 2 ; honnêteté app : Lot 0.5 |
| LEG-01 | P1 | EN COURS | prima/index.html | Textes légaux consultables avant inscription ; champs éditeur « À COMPLÉTER » ; blocage publication commerciale si incomplet | Test : accès légal depuis l'écran d'auth ; placeholders présents |
| UX-01 | P2 | EN COURS | prima/index.html | Labels associés aux champs ; erreurs liées au champ + annonce lecteur d'écran | Test : `label[for]`/aria sur champs d'auth |
| UX-02 | P2 | EN COURS | prima/index.html | Correction débordement `#auth-screen` (cercles décoratifs contenus) | Test : scrollWidth ≤ clientWidth aux largeurs cibles |
| TECH-01 | P2 | EN COURS | prima/index.html | Autoriser le zoom ; `prefers-reduced-motion` | Test : viewport sans user-scalable=no ; media query présente |
| TECH-02 | P2 | MITIGÉ | prima/, tests/ | Harnais de tests minimal + contrôle JS ; modularisation = Lot 4 | Test : script de vérif exécuté |

## Preuves

Les preuves (sorties de tests, captures) sont déposées dans
`/tmp/.../scratchpad` pendant le développement et résumées ici au fil des lots.
