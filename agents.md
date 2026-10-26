# Règles Spécifiques pour les Agents IA dans Cline

## 1. Utilisation des Outils Claude Code
### Outils Autorisés
- **Autorisés** : `Bash`, `Read`, `Write`, `Edit`, `Agent`, `Artifact`, `TaskCreate`, `TaskUpdate`.
- **Restrictions** :
  - **Pas d'utilisation de `TaskCreate` ou `TaskUpdate`** sans justification claire.
  - **Pas de commandes destructrices** (`rm -rf`, `git reset --hard`, etc.) sans accord explicite.

### Permissions
- **Permissions globales** :
  - Accès à `Bash`, `Read`, `Write`, `Agent`, etc.
  - **Demander avant** de modifier des fichiers sensibles (`.git`, `lockfiles`, CI).

---

## 2. Gestion des Tâches
### Tâches Incrémentales
- **Planifier chaque tâche** en petites étapes.
- **Communiquer après chaque modification** :
  - Ce qui a changé.
  - Comment tester.
  - Prochaine étape.

### Gestion des Échecs
- **Lire l'erreur réelle** et corriger la cause racine.
- **Max 2 tentatives** avant de s'arrêter et d'expliquer la situation.

---

## 3. Optimisation des Ressources
### Économie des Tokens
- **Ne pas relire un fichier déjà en contexte**.
- **Éviter les pastes longues** : Le code doit être dans les fichiers.
- **Utiliser des diffs ou des remplacements ciblés** (`Edit`) plutôt que de réécrire des fichiers entiers.

---

## 4. Respect des Conventions Techniques
### Conventions de Code
- **Respecter les conventions existantes** (style, noms, etc.).
- **Pas de hardcoding** : Utiliser les CSS tokens (`src/styles/theme.css`).
- **Pas de secrets durcis** : Utiliser `.env.example` et ignorer `.env` dans `.gitignore`.

### Tests
- **Exécuter les tests après chaque modification** (`npm run check`, `npm run smoke`, `npm run theme`).
- **Ne pas affirmer "ça marche" sans exécuter les tests**.

---

## 5. Communication et Documentation
### Langue
- **Français** pour les échanges avec l'utilisateur.
- **Anglais** pour le code et les commentaires.

### Documentation
- **Maintenir `README.md` et `TODO.md` à jour**.
- **Ajouter des tests** pour chaque nouvelle fonctionnalité.

---

## 6. Sécurité
### Restrictions
- **Pas de modifications hors du projet** (pas de `.git`, `lockfiles`, CI, etc.).
- **Pas de suppression de fichiers** sans accord explicite.
- **Pas d'envoi de données sensibles** sans action utilisateur explicite.

---

## 7. Exemples de Comportements Attendus
### Exemple de Planification
- **Avant de coder** :
  ```plaintext
  Plan : Ajouter une nouvelle fonctionnalité d'analyse des en-têtes d'emails.
  Étapes :
  1. Créer une nouvelle fonction dans `src/lib/utils/emailHeaders.js`.
  2. Ajouter un test dans `tests/emailHeaders.test.js`.
  3. Mettre à jour `src/data/tools.json` si nécessaire.
  4. Tester avec `npm run smoke`.
  ```

### Exemple de Communication Après Modification
```plaintext
J'ai ajouté la fonctionnalité d'analyse des en-têtes d'emails dans `src/lib/utils/emailHeaders.js`.
Pour tester : `npm run smoke`.
Prochaine étape : Ajouter un composant pour afficher les résultats dans `src/lib/components/`.
```

---

## 8. Interdits
### Interdictions Claires
- **Pas de commandes destructrices** sans accord.
- **Pas de modifications hors du projet** sans accord.
- **Pas de pastes longues** de code en chat.
- **Pas de refactoring complet** sans accord.