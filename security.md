# Règles de Sécurité pour le Projet Cline

## Introduction
Ce document décrit les règles de sécurité spécifiques à suivre pour l'application **Cline**, une application web statique pour l'analyse des Indicateurs de Compromis (IoCs).

---

## 1. Principes de Base
- **Pas de Backend** : Tout s'exécute dans le navigateur.
- **Pas d'Envoi Automatique de Données Sensibles** : Aucune donnée sensible ne doit être envoyée vers des serveurs tiers sans une action utilisateur explicite.
- **Pas de Verdicts Automatiques** : Ne pas dériver de verdicts comme "Safe" ou "Malicious". Afficher les résultats bruts des services externes.
- **Pas d'Exécution Automatique de Requêtes** : Aucune requête HTTP ne doit être envoyée automatiquement à partir des entrées utilisateur.

---

## 2. Conformité des Fichiers Existants
### `fast-analyze.js`
- **Problème** : Les requêtes HTTP sont envoyées automatiquement dès qu'une entrée utilisateur est fournie.
- **Solution** : Ajouter une confirmation utilisateur avant chaque requête externe.

**Exemple de modification** :
```javascript
async function sendExternalRequest(url, options) {
  if (!confirm("Souhaitez-vous envoyer cette requête externe pour analyse ?")) {
    throw new Error("Requête annulée par l'utilisateur.");
  }
  return this.#fetchJson(url, options);
}
```

### `deep-links.js`
- **Problème** : Génération de liens profonds qui pourraient être ouverts automatiquement.
- **Solution** : Afficher les liens de manière interactive et demander une confirmation avant l'ouverture.

---

## 3. Bonnes Pratiques pour la Sécurité
### Pas d'Envoi Automatique de Données
- **Règle** : Ne pas envoyer automatiquement des données IoC, des en-têtes d'emails ou des logs vers des serveurs tiers.
- **Exemple** : Utiliser une confirmation utilisateur avant toute requête externe.

### Pas de Verdicts Automatiques
- **Règle** : Afficher les résultats des analyses comme des données inertes sans interprétation automatique.
- **Exemple** : Montrer les résultats bruts des services externes sans ajouter de commentaires interprétatifs.

### Pas d'Exécution Automatique de Requêtes
- **Règle** : Ne pas ouvrir automatiquement des liens externes ou effectuer des requêtes HTTP sans confirmation utilisateur.
- **Exemple** : Utiliser des boutons cliquables pour les liens profonds et demander une confirmation avant l'ouverture.

---

## 4. Documentation et Tests
### Documentation
- Maintenir ce fichier `security.md` à jour avec les dernières bonnes pratiques et les outils utilisés.

### Tests de Sécurité
- **Tests réguliers** pour vérifier que les entrées utilisateur ne sont pas exploitées de manière malveillante.
- **Vérification des dépendances** pour s'assurer qu'elles ne contiennent pas de vulnérabilités connues.

---

## 5. Exemple de Code Sécurisé
### Exemple de Requête avec Confirmation Utilisateur
```javascript
async function sendIoCAnalysis(ioc) {
  if (!confirm("Souhaitez-vous envoyer cette IoC pour analyse ?")) {
    return;
  }
  // Code pour envoyer l'IoC au service externe
  const response = await fetch(`https://api.example.com/analyze?ioc=${ioc}`);
  const data = await response.json();
  return data;
}
```

### Exemple d'Affichage des Liens Profonds
```javascript
// Afficher les liens de manière interactive
const deepLinks = getDeepLinks(iocType, value, tools);

deepLinks.forEach(link => {
  const linkElement = document.createElement('a');
  linkElement.href = link.url;
  linkElement.textContent = link.name;
  linkElement.target = '_blank';
  linkElement.rel = 'noopener noreferrer';
  document.body.appendChild(linkElement);
});
```

---

## 6. Conclusion
Les règles de sécurité de Cline sont conçues pour minimiser les risques liés à l'utilisation d'outils externes et à la manipulation des entrées utilisateur. Il est crucial de maintenir ces règles et de les appliquer strictement pour garantir la sécurité de l'application.