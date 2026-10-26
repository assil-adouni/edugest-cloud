# Scénario de démonstration (5 à 10 minutes)

**Avant de commencer (2 min avant)** : ouvrez l'URL publique pour réveiller le service gratuit (veille après 15 min) et vérifiez `/health`.

## Présenter l'architecture (30 s)
« L'utilisateur ouvre l'application depuis son **navigateur** en HTTPS. Elle est **hébergée sur un PaaS (Render)** : je n'administre aucun serveur, je fournis seulement le code. Elle se connecte à une **base PostgreSQL managée** grâce à la variable d'environnement `DATABASE_URL`. Les données sont donc conservées même si le service redémarre. »

## Déroulé
1. **URL publique** : ouvrez `https://…onrender.com`, montrez le cadenas HTTPS puis `/health` (`database: ok`).
2. **Admin** (`admin@edugest.demo` / `Admin123!`) : montrez le tableau de bord (chiffres issus de la base, dernières activités, annonces).
3. **Ajouter un élève** : *Élèves → Ajouter un élève* (ex. Salma Test, 1ère année A, parent Khelifi). Retrouvez-la avec la recherche.
4. **Matière** : *Matières* → modifiez le coefficient de « Mathématiques » (ex. 2 → 3). Essayez de supprimer une matière qui a des notes : refus avec message.
5. **Enseignant** (`prof1@edugest.demo` / `Prof123!`) : *Notes* → 1ère année A, Mathématiques, trimestre 2 → saisissez des notes → *Enregistrer*.
6. **Moyenne** : la colonne « Moyenne du trimestre » est recalculée avec les coefficients (Σ note × coef ÷ Σ coef). Ouvrez le *Bulletin* d'un élève.
7. **Comptable** (`compta@edugest.demo` / `Compta123!`) : *Paiements → Enregistrer un paiement* (Yassine Khelifi, 100 TND, statut Payé). Montrez la confirmation, le total payé et le solde restant ; ouvrez *En attente* et validez un paiement.
8. **Notification** : le message de confirmation précise que la notification est interne (simulée, aucun e-mail).
9. **Parent** (`parent1@edugest.demo` / `Parent123!`) : *Notifications* (paiement reçu), *Mes enfants* (moyennes, solde, paiements, devoirs). Essayez le bulletin d'un enfant d'une autre famille : accès refusé.
10. **Persistance** : sur Render, *Manual Deploy → Deploy latest commit* (ou *Restart*). Une fois « Live », reconnectez-vous : l'élève, les notes et le paiement sont toujours là.

## Questions probables
- *Pourquoi un PaaS ?* Pas d'administration système, déploiement depuis GitHub, HTTPS et base managée inclus.
- *Où sont les secrets ?* Dans les variables d'environnement Render, jamais dans GitHub.
- *Quelle sécurité ?* Mots de passe hachés, requêtes SQL paramétrées, droits vérifiés côté serveur, jeton CSRF.
- *Limites du gratuit ?* Mise en veille après 15 min, base gratuite expirant après 30 jours.
