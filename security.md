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
- **Principe** : Les requêtes HTTP vers les APIs publiques keyless (ipapi.is, ipwho.is, rdap.org, crt.sh) ne sont envoyées qu'après une action utilisateur explicite (clic sur "Start" dans le modal Fast Analyze). Aucune requête n'est envoyée automatiquement à la saisie.
- **Solution** : Pas de `confirm()` par requête — cela bloquerait les environnements sans `window` et créerait un mauvais UX. L'action explicite est le clic sur "Start" ; chaque requête rapporte son propre statut (ok / empty / error) sans bloquer les autres.

### `deep-links.js`
- **Principe** : Les liens profonds ("go further") sont affichés comme des boutons cliquables ; aucune ouverture automatique. L'analyste choisit volontairement d'ouvrir l'outil externe dans un nouvel onglet.
- **Solution** : Pas de `confirm()` — chaque lien est un `<a>` explicite avec `target="_blank" rel="noopener noreferrer"`, ouvert uniquement sur clic utilisateur.

---

## 3. Bonnes Pratiques pour la Sécurité
### Pas d'Envoi Automatique de Données
- **Règle** : Ne pas envoyer automatiquement des données IoC, des en-têtes d'emails ou des logs vers des serveurs tiers.
- **Exemple** : Les requêtes vers les APIs keyless (ipapi.is, rdap.org, crt.sh) ne partent qu'après un clic explicite sur "Start" dans le modal Fast Analyze ; chaque requête rapporte son propre statut (ok / empty / error) sans bloquer les autres.

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
### Exemple de Requête avec Action Utilisateur Explicite
```javascript
async function sendIoCAnalysis(ioc, { fetch = globalThis.fetch } = {}) {
  // L'appel n'intervient qu'après un clic explicite sur "Start" dans le modal.
  // Chaque requête est indépendante : un échec ne bloque pas les autres.
  const response = await fetch(`https://api.example.com/analyze?ioc=${encodeURIComponent(ioc)}`);
  if (!response.ok) throw new Error(`Provider error: ${response.status}`);
  return response.json();
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