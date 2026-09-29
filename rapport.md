# RAPPORT D’ACTIVITÉS

## Stage de développement — Lixali Studio

**Stagiaire :** CODJA Gedeon Joel  
**Poste :** Stagiaire développeur  
**Encadrant :** Elikem Medehou (Lead Developer)  
**Période :** 18 juin 2026 – 18 septembre 2026

## 1. Synthèse des trois mois

Le stage s'est déroulé du 18 juin au 18 septembre 2026.

Les premières semaines ont été consacrées à un projet bac à sable sous Flutter. Cette TodoApp avait uniquement un objectif d'apprentissage : me permettre de prendre en main le développement mobile et les technologies utilisées, que je ne maîtrisais pas encore suffisamment.

À partir du 13 juillet, la majeure partie du stage a été consacrée au développement de **MakiSend**, un service d'envoi d'emails transactionnels serverless. Le projet a été conçu pendant le stage, sous la supervision de mon encadrant.

Les travaux sur MakiSend ont principalement porté sur l'architecture, le backend, le frontend, la gestion des données, l'authentification, le chiffrement, les tests, le traitement asynchrone et le déploiement.

## 2. Activités réalisées

### 2.1 TodoApp Flutter (Projet bac à sable)

**Période :** 18 juin – 2 juillet

Développement d'une application mobile de gestion de tâches avec Flutter.

**Fonctionnalités réalisées :**

- Création, modification, consultation et suppression des tâches.
- Tri des tâches par date.
- Fonctionnement hors ligne.
- Synchronisation avec Firebase Firestore.
- Gestion des états avec Cubit.
- Persistance locale avec Isar.
- Tests unitaires sur les repositories et les cubits.
- Ajout d'animations d'interface.

**Technologies utilisées :**

- Flutter, Dart, Cubit, Isar, Firebase Firestore.

### 2.2 Période de transition et préparation de MakiSend

**Période :** 2 – 12 juillet

Cette période a principalement été consacrée à la préparation du projet MakiSend.

- Recherche et prise en main des technologies envisagées pour MakiSend.
- Premiers échanges sur l'architecture et le fonctionnement du service.
- Définition progressive des besoins et des choix techniques du projet.

### 2.3 MakiSend

**Période :** 13 juillet – 18 septembre

Le développement s'est fait progressivement, avec plusieurs phases correspondant aux différents besoins du projet.

#### 2.3.1 POC d'envoi d'emails

**Période :** 13 – 29 juillet

Mise en place de la première version du backend et validation de l'envoi d'emails depuis Cloudflare Workers.

**Réalisations :**

- Mise en place d'une architecture backend modulaire.
- Séparation des contrôleurs, des services et des repositories.
- Mise en place de l'injection de dépendances à l'aide de factories.
- Envoi d'emails avec Nodemailer et SMTP.
- Gestion des contraintes du runtime Cloudflare Workers.
- Mise en place de Cloudflare D1 pour la persistance.
- Migration de Prisma vers Drizzle ORM.
- Chiffrement AES-256-GCM des données sensibles avec Web Crypto.
- Validation des données avec Zod.
- Mise en place de Pino pour les logs.
- Gestion centralisée des erreurs.
- Mise en place de Vitest pour les tests.
- Configuration d'ESLint.
- Mise en place du premier pipeline d'intégration continue.

#### 2.3.2 Authentification et traitement asynchrone

**Période :** 2 août – 2 septembre

Travail sur l'authentification et l'exécution asynchrone des envois.

**Réalisations :**

- Mise en place de l'authentification par clé d'API.
- Association des clés d'API aux configurations SMTP.
- Intégration de Better Auth.
- Mise en place de l'authentification par session.
- Amélioration de l'injection des dépendances.
- Intégration d'Inngest pour le traitement asynchrone des emails.
- Réorganisation du backend autour des fonctions et jobs Inngest.
- Mise en place de tests d'intégration.
- Utilisation de Miniflare pour tester l'application avec une base D1.
- Intégration des tests Better Auth et Inngest.

#### 2.3.3 MVP interne

**Période :** 8 – 15 septembre

Développement des modules nécessaires à l'utilisation interne de MakiSend.

**Réalisations :**

- Réorganisation du projet en monorepo avec séparation du backend et du frontend.
- Développement du CRUD des configurations SMTP.
- Chiffrement des informations SMTP sensibles avant leur stockage.
- Développement du CRUD des clés d'API.
- Association des clés d'API aux configurations SMTP.
- Développement de l'historique des emails.
- Gestion des statuts de traitement des emails.
- Développement du tableau de bord et des statistiques.
- Développement des écrans de connexion et d'inscription.
- Sécurisation des routes de gestion par session utilisateur.

#### 2.3.4 CI/CD et déploiement

**Période :** 17 – 18 septembre

Mise en place de l'automatisation du déploiement avec GitHub Actions.

**Réalisations :**

- Création du workflow de déploiement.
- Mise en place d'un environnement de preview pour les pull requests.
- Création automatique d'une base D1 pour les previews.
- Application automatique des migrations.
- Déploiement du Worker backend.
- Déploiement du frontend sur Cloudflare Pages.
- Mise en place de l'environnement de production.
- Gestion des secrets dans le pipeline.
- Récupération automatique des URLs de déploiement.
- Configuration du build frontend avec l'URL du backend.

Des problèmes de CORS et de gestion des cookies de session sont apparus lors des tests avec le frontend et l'API déployés sur des domaines différents. Leur correction était encore en cours à la fin du stage.

---

#### 2.3.5 Stack technique

À la fin du stage, MakiSend reposait sur la stack technique suivante :

| Couche | Technologies |
|---|---|
| Runtime | Cloudflare Workers (workerd) |
| Framework backend | Hono |
| Base de données | Cloudflare D1 (SQLite) |
| ORM | Drizzle ORM |
| Validation | Zod + @hono/zod-validator |
| Envoi d'emails | Nodemailer (SMTP brut) |
| Authentification | Better Auth (sessions + API keys) |
| Traitement asynchrone | Inngest (jobs, queues) |
| Chiffrement | Web Crypto API (AES-256-GCM) |
| Logs / observabilité | Pino |
| Frontend | Astro + React + Tailwind + shadcn/ui |
| Tests | Vitest |
| CI/CD | GitHub Actions → Cloudflare Workers & Pages |
