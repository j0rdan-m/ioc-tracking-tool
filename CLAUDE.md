# Règles et Conventions pour le Projet Cline

## 1. Langue et Communication
- **Français** pour les échanges avec l'utilisateur (réponses, explications).
- **Anglais** pour :
  - Le code.
  - Les commentaires.
  - Les messages de commit.
  - La documentation.

---

## 2. Objectifs du Projet
### But
- **IOC Investigation Toolkit** : Une application web statique en **Svelte 5** pour les analystes en cybersécurité.
  - Catalogue des outils IoC dans `src/data/tools.json`.
  - Fonctionnalités : Analyse rapide, Extraction IoCs, Analyse par lots, Analyse des en-têtes d'emails.

### Stack Technique
- **Frontend** : Svelte 5 + Vite.
- **Pas de backend** : Déploiement sur **GitHub Pages**.
- **Tests** :
  - `npm run check` (svelte-check).
  - `npm run smoke` (tests unitaires).
  - `npm run theme` (vérification des conventions de style).

---

## 3. Méthode de Travail
### Planification
- Avant de coder, fournir un **plan court (max 8 lignes)** et attendre l'accord de l'utilisateur (« ok »).

### Étapes Incrémentales
- Travailler par **petites étapes** (une fonctionnalité ou une correction à la fois).
- **Pas de refactoring complet** du projet.

### Clarification
- Si une tâche est ambiguë, poser **une seule question courte** avant d'avancer.

### Communication
- Après chaque étape, dire :
  - Ce qui a changé.
  - Comment le tester.
  - Quelle est la prochaine étape.

---

## 4. Économie des Tokens et des Requêtes
- **Lecture ciblée** : Ne lire que les fichiers nécessaires.
- **Éditions précises** : Utiliser des diffs ou des remplacements ciblés (`Edit`).
- **Pas de pastes longues** : Le code doit être dans les fichiers, pas en chat.
- **Batch des modifications** : Regrouper les modifications liées dans une seule requête.

---

## 5. Qualité du Code
### Conventions
- Respecter les conventions existantes (style, noms de variables/fonctions).
- **Fonctions courtes et claires** : Commenter le « pourquoi », pas le « comment ».

### Validation
- Valider les entrées aux frontières des fonctions.
- **Gérer les erreurs explicitement** (pas de suppression silencieuse des exceptions).

### Sécurité
- **Pas de secrets durcis** : Utiliser des variables d'environnement (`.env.example`).
- **Pas de dépendances inutiles** : Éviter d'ajouter des bibliothèques sans justification.

---

## 6. Tests et Vérification
- **Tests obligatoires** après chaque modification.
- Exécuter `npm run check`, `npm run smoke`, et `npm run theme`.
- **Pas de "ça marche" sans tests** : Toujours lire l'erreur réelle et corriger la cause racine.

---

## 7. Gestion de Git
- **Commits fréquents** avec des messages clairs et impératifs (< 72 caractères).
- **Interdiction des commandes destructrices** (`rm -rf`, `git reset --hard`, `git push --force`).

---

## 8. Sécurité et Frontières
- **Pas de modifications hors du projet** (pas de `.git`, `lockfiles`, CI, ou fichiers de configuration sans accord).
- **Pas de suppression de fichiers** sans accord explicite.

---

## 9. Documentation
- Maintenir `README.md` et `TODO.md` à jour.

---

## 10. Conventions Techniques Spécifiques à Cline
### Catalogue des Outils
- Les outils IoC **uniquement dans `src/data/tools.json`** (suivre le schéma existant).
- **Pas de hardcoding** dans les composants.

### Logique Pure
- Logique métier dans `src/lib/utils/` (indépendante du framework).
- Services dans `src/lib/services/`.
- Composants dans `src/lib/components/` (restent minces).

### Injection de Dépendances
- Utiliser le **DI container** (`src/lib/bootstrap.js`, `DI_TOKENS`).
- **Pas d'imports directs** de singletons ou d'appels à `fetch`/`localStorage` dans les composants.

### Styling
- Utiliser **uniquement les CSS tokens** (`src/styles/theme.css`).
- **Pas de couleurs, rayons, tailles de police ou ombres durcies** dans les composants.

### Privacy
- Tout s'exécute dans le navigateur.
- **Pas d'envoi d'IoCs ou de logs** vers un serveur autre que les **API publiques documentées**.
- **Action utilisateur explicite** requise avant toute requête.

### Fonctionnalités Hors Portée
- Pas de backend, de base de données, d'authentification, d'API clés ou de fournisseurs payants.
- Pas de téléchargement de fichiers vers des tiers.
- Pas de verdicts automatiques ou de scoring.
- Pas d'e-commerce ou de publicité.