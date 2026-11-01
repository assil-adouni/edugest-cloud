# EduGest Cloud — Gestion d'école primaire (déploiement mono-école)

Projet universitaire — cours « Introduction au Big Data et Cloud Computing », ISG Sousse (Licence en Informatique de Gestion, 3ᵉ année).

## 1. Contexte et objectifs
EduGest Cloud est une application web **de démonstration** qui gère **une seule école primaire** : élèves, classes, enseignants, matières, notes, paiements, devoirs, annonces et messagerie.
Objectif principal : **montrer une application hébergée sur un PaaS**, accessible par Internet (HTTPS), avec un backend, une base PostgreSQL persistante et une architecture simple à expliquer.
Ce n'est **pas** une plateforme SaaS multi-écoles (pas d'abonnement, ni de facturation SaaS).

## 2. Technologies et rôle
| Technologie | Rôle |
|---|---|
| Node.js + Express | Serveur web et logique métier (application monolithique) |
| EJS + Bootstrap 5 | Pages HTML générées côté serveur, interface responsive en français |
| PostgreSQL + `pg` | Base relationnelle, requêtes SQL **paramétrées** |
| `express-session` + `connect-pg-simple` | Sessions stockées en base (elles survivent aux redémarrages) |
| `bcryptjs` | Hachage des mots de passe (version JavaScript pur de bcrypt : aucune compilation, donc installation sans problème sous Windows et sur le PaaS) |
| Render (PaaS) | Hébergement du service web + base PostgreSQL managée |
| Git / GitHub | Versionnement et déclenchement du déploiement |

## 3. Architecture
```mermaid
flowchart LR
  U[Navigateur<br/>admin / enseignant / parent / comptable] -- HTTPS --> W[Application Node.js + Express<br/>hébergée sur le PaaS Render]
  W -- SQL via DATABASE_URL --> D[(PostgreSQL managé)]
  G[Dépôt GitHub] -- déploiement automatique --> W
```
Pour l'oral : *navigateur → application web hébergée sur le PaaS → base PostgreSQL managée*. Les secrets (`DATABASE_URL`, `SESSION_SECRET`) sont des **variables d'environnement**, jamais dans le code.

### Schéma logique de la base
```mermaid
erDiagram
  users ||--o| teachers : "est"
  users ||--o| parents : "est"
  teachers ||--o{ classes : "responsable"
  classes ||--o{ students : "contient"
  parents ||--o{ students : "a pour enfants"
  students ||--o{ grades : "reçoit"
  subjects ||--o{ grades : "concerne"
  students ||--o{ payments : "paie"
  classes ||--o{ homework : "reçoit"
  subjects ||--o{ homework : "concerne"
  users ||--o{ announcements : "publie"
  users ||--o{ messages : "envoie/reçoit"
  users ||--o{ notifications : "reçoit"
```
Les tables métier portent `annee_scolaire` pour conserver l'historique. Les clés étrangères en `RESTRICT` empêchent les suppressions incohérentes (classe contenant des élèves, matière ayant des notes, élève ayant des paiements).

## 4. Fonctionnalités par rôle
| Rôle | Accès |
|---|---|
| Administrateur | Tableau de bord complet, élèves (CRUD + recherche), classes, matières, comptes utilisateurs, consultation des notes/paiements/devoirs, annonces |
| Enseignant | Ses classes, saisie/modification des notes (moyenne pondérée calculée automatiquement), publication de devoirs, messagerie |
| Parent | Notes et moyennes de ses enfants (bulletin), devoirs, paiements et solde, notifications, messagerie |
| Comptable | Enregistrement et historique des paiements, total payé, solde restant, paiements en attente (validation), messagerie |

Les droits sont **vérifiés côté serveur** à chaque route (`middleware/auth.js`).

## 5. Installation locale (Windows)
Prérequis : [Node.js LTS](https://nodejs.org), [PostgreSQL](https://www.postgresql.org/download/windows/) (retenez le mot de passe de l'utilisateur `postgres`), [Git](https://git-scm.com).

```powershell
cd edugest-cloud
npm install
copy .env.example .env
```
1. Créez la base : ouvrez **SQL Shell (psql)** puis `CREATE DATABASE edugest;`
2. Éditez `.env` : `DATABASE_URL=postgresql://postgres:VOTRE_MOT_DE_PASSE@localhost:5432/edugest`
3. Lancez `npm start`, puis ouvrez http://localhost:3000

Au premier démarrage, l'application **crée les tables et insère les données fictives** si la base est vide (`AUTO_INIT_DB=true`). Manuellement : `npm run db:init`. Pour tout effacer et recommencer : `npm run db:reset`.
Le script est **idempotent** : relancé, il ne crée aucun doublon.

## 6. Comptes de démonstration (données fictives)
| Rôle | Email | Mot de passe |
|---|---|---|
| Administrateur | admin@edugest.demo | Admin123! |
| Enseignant (1ʳᵉ et 3ᵉ années) | prof1@edugest.demo | Prof123! |
| Enseignant (2ᵉ année) | prof2@edugest.demo | Prof123! |
| Comptable | compta@edugest.demo | Compta123! |
| Parent (Khelifi : Yassine, Nour) | parent1@edugest.demo | Parent123! |
| Parent (Dridi : Sarra, Adam) | parent2@edugest.demo | Parent123! |
| Parent (Bouazizi : Ines, Rayan) | parent3@edugest.demo | Parent123! |

> Ces mots de passe servent **uniquement à la démonstration**. Après la présentation, supprimez ou changez ces comptes (page *Utilisateurs*).

## 7. Déploiement sur Render (PaaS)
Render est recommandé : service web Node et PostgreSQL gratuits, HTTPS automatique, déploiement depuis GitHub, sans carte bancaire.

### 7.1 Publier sur GitHub
```powershell
git init
git add .
git commit -m "EduGest Cloud - version initiale"
git branch -M main
```
Créez un dépôt **vide** sur github.com (New repository, sans README), puis :
```powershell
git remote add origin https://github.com/VOTRE_NOM/edugest-cloud.git
git push -u origin main
```
Vérifiez que `.env` n'apparaît pas sur GitHub (il est dans `.gitignore`).

### 7.2 Méthode rapide : Blueprint (`render.yaml`)
1. Sur [render.com](https://render.com), connectez-vous avec GitHub.
2. **New → Blueprint**, choisissez votre dépôt, puis **Apply**.
3. Render crée la base `edugest-db` et le service `edugest-cloud`, relie `DATABASE_URL` et génère `SESSION_SECRET`.
4. Attendez « Live » : l'URL publique `https://edugest-cloud-xxxx.onrender.com` s'affiche en haut du service.

### 7.3 Méthode manuelle (si le Blueprint pose problème)
1. **New → PostgreSQL** : nom `edugest-db`, plan **Free**. Une fois créée, copiez l'**Internal Database URL**.
2. **New → Web Service** → votre dépôt. Runtime **Node**, Build Command `npm install`, Start Command `npm start`, plan **Free**.
3. Onglet **Environment**, ajoutez :

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | Internal Database URL de la base |
| `SESSION_SECRET` | une longue chaîne aléatoire |
| `NODE_ENV` | `production` |
| `ANNEE_SCOLAIRE` | `2026-2027` |
| `AUTO_INIT_DB` | `true` |

4. Dans *Settings*, **Health Check Path** = `/health`. Lancez **Manual Deploy → Deploy latest commit**.
5. Si vous utilisez l'*External* Database URL (depuis votre PC), ajoutez `DATABASE_SSL=true`.

### 7.4 Vérifications après déploiement
- `https://VOTRE-URL/health` répond `{"status":"ok","database":"ok",...}`.
- La page de connexion s'affiche en HTTPS ; la connexion admin fonctionne.
- Le tableau de bord affiche des chiffres issus de la base.
- Dans les *Logs* Render : « Tables prêtes » puis « Données de démonstration insérées » (premier démarrage seulement).
- **Test de persistance** : redéployez ou redémarrez le service, puis vérifiez que les données ajoutées sont toujours là.

### 7.5 Limites du niveau gratuit de Render (consultées en octobre 2026, à reconfirmer sur la [documentation officielle](https://render.com/docs/free))
- Le service web **se met en veille après 15 minutes** sans trafic ; la requête suivante prend environ une minute. **Ouvrez l'URL 2 minutes avant la présentation.**
- La base PostgreSQL gratuite **expire 30 jours après sa création** (14 jours de grâce avant suppression) : créez-la peu avant la soutenance.
- Le système de fichiers du service est éphémère : c'est pourquoi **toutes** les données (sessions comprises) sont dans PostgreSQL.
- Alternative : Railway (ajouter un service PostgreSQL, puis référencer sa variable `DATABASE_URL` dans le service web). Le code ne change pas.

## 8. Tests à effectuer
| Test | Résultat attendu |
|---|---|
| `GET /health` | `status: ok` |
| Connexion avec un mauvais mot de passe | Message d'erreur, pas de session |
| Enseignant ouvre `/students` | Accès refusé (403) |
| Admin : ajouter, rechercher, modifier, supprimer un élève (avec confirmation) | Opérations réussies |
| Admin : supprimer une classe qui contient des élèves | Refus avec message |
| Enseignant : saisir des notes du trimestre 2 | Moyenne pondérée recalculée |
| Enseignant : note 25 | Refusée (0 à 20) |
| Comptable : paiement « payé » | Confirmation + notification pour le parent |
| Comptable : montant supérieur au solde restant | Refusé |
| Parent : bulletin d'un enfant d'une autre famille | Accès refusé |
| Redémarrage du service | Données conservées |

Le déroulé de présentation est dans `docs/SCENARIO.md`.

## 9. Limites de la démonstration
- Notifications **simulées dans l'application** : aucun e-mail n'est envoyé.
- Messagerie minimale : pas de pièces jointes, pas de fil de discussion, pas de temps réel.
- Un enseignant est responsable d'une classe et saisit les notes de toutes les matières de cette classe.
- Un seul parent par élève ; une seule année scolaire courante (`ANNEE_SCOLAIRE`).
- Pas de limitation des tentatives de connexion, pas de réinitialisation de mot de passe, pas de sauvegarde automatique (niveau gratuit).
- Bootstrap est chargé depuis un CDN : un accès Internet est nécessaire pour l'affichage.
- Monnaie affichée : TND.

## 10. IaaS, PaaS, SaaS en bref
- **IaaS** (ex. machines virtuelles AWS EC2) : le fournisseur loue l'infrastructure ; *vous* installez et administrez l'OS, Node.js, la base, les mises à jour.
- **PaaS** (ex. Render, Railway) : le fournisseur gère l'infrastructure **et** l'environnement d'exécution ; *vous* déployez seulement votre code et votre configuration.
- **SaaS** (ex. Gmail, Microsoft 365) : application complète utilisée telle quelle ; rien à développer ni à héberger.

**Ce projet utilise un PaaS** (Render) pour héberger l'application et sa base PostgreSQL. EduGest Cloud n'est pas lui-même un SaaS : il sert une seule école.

## 11. Structure du projet
```
edugest-cloud/
├── server.js            # Démarrage, sessions, CSRF, /health
├── db.js                # Connexion PostgreSQL (DATABASE_URL)
├── render.yaml          # Blueprint Render (service + base)
├── sql/schema.sql       # Création des tables
├── scripts/             # init-db.js (création) et seed.js (données fictives)
├── lib/                 # helpers, requêtes partagées (soldes, moyennes)
├── middleware/auth.js   # Contrôle des rôles
├── routes/              # une route par module
├── views/               # Pages EJS
├── public/              # CSS et JS
└── docs/SCENARIO.md     # Scénario de présentation
```
