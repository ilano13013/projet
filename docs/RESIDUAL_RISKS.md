# PRIMA — Risques résiduels & critères go/no-go

## Risques résiduels après Lot 0 (applicatif seul, sans serveur)
- **Pas de frontière de sécurité réelle.** Tant que le Lot 1 n'est pas livré,
  l'identité, la session, le rôle et le droit payant restent côté navigateur.
  Le Lot 0 réduit les fuites et les fausses promesses mais **ne rend pas
  l'application sécurisée**. Ne pas ouvrir à de vrais utilisateurs.
- **Données déjà potentiellement exposées (SEC-04 historique).** À revoir par
  le propriétaire (cf. MISSING_ACCESS).
- **Données métier en localStorage.** Non chiffrées, non sauvegardées, liées au
  navigateur. Aucune valeur probante juridique (le carnet n'est pas une preuve
  opposable du seul fait de son horodatage applicatif).
- **Emails/visio/paiement = démonstration.** Marqués comme tels ; non
  opérationnels.

## Ce que le Lot 0 n'affirme PAS
- Aucune certification, aucun chiffrement de bout en bout, aucune conformité
  réglementaire ne découle d'une bibliothèque ou d'un écran.
- Aucun résultat Lighthouse / RGAA / pentest n'est revendiqué sans exécution.
  Les contrôles non exécutés restent **À vérifier**.

## Critères go/no-go pour un pilote
**NO-GO tant que** l'un de ces points n'est pas satisfait :
1. Socle serveur (Lot 1) : identité éprouvée, autorisation serveur « refus par
   défaut », sessions révocables, stockage fichiers privé.
2. Parcours réel (Lot 2) démontré avec 2 comptes et 2 contextes navigateur sur
   staging autorisé, anti-double-réservation par contrainte base vérifié.
3. Paiement SaaS en mode test : webhooks signés/idempotents, droits calculés
   serveur, gestion impayé/résiliation (Lot 3).
4. Textes légaux complétés et validés (LEG-01), accessibles avant inscription.
5. Tests significatifs §8 de l'audit exécutés et documentés (séparation
   cabinets/particuliers, reset expiré/réutilisé, double réservation, quota,
   panne email, webhook falsifié/dupliqué, numérotation concurrente, etc.).
6. Sauvegarde/restauration réellement testées ; migration + retour arrière
   documentés.

**GO pilote restreint** possible seulement après 1–5, sur environnement
staging isolé, fixtures fictives, sans données réelles.
