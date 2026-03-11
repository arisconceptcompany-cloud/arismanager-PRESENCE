# PresenceAris

Application web de gestion des présences avec badges QR — entrées/sorties, fiches imprimables, badges PDF.

## Fonctionnalités

- **Connexion** : authentification (admin / admin123 par défaut)
- **Tableau de bord** : statistiques et dernières présences
- **Employés** : liste, ajout, modification, suppression ; Badge ID unique par employé
- **Badges** : génération de badges PDF (design zone sombre + rose), QR unique par employé, fiche imprimable, exemple de badge
- **Scanner** : page caméra pour scanner le QR et enregistrer **entrée** ou **sortie**
- **Présences** : historique des pointages, pagination, export JSON
- **Fiches de présence** : fiches mensuelles imprimables (employés × jours du mois), **sauvegarde automatique**, impression
- **Logo** : `logo.png` (ARIS CONCEPT) dans l’interface

## Installation

```bash
cd PresenceAris
npm install
npm start
```

Sous Windows, si `npm` n’est pas reconnu : ajouter Node au PATH ou utiliser `npm.cmd` et les scripts `install.bat` / `start.bat`.

Ouvrir : **http://localhost:3000**

## Compte par défaut

| Champ          | Valeur     |
|----------------|------------|
| **Identifiant** | `admin`   |
| **Mot de passe** | `admin123` |

## URLs principales

| Page              | URL                    |
|-------------------|------------------------|
| Connexion         | `/login`               |
| Tableau de bord   | `/`                    |
| Employés          | `/employes`            |
| Badges            | `/badges`              |
| Exemple de badge  | `/badge-exemple`       |
| Scanner           | `/scanner`             |
| Historique présences | `/presences`        |
| **Fiches de présence** | **`/fiches-presence`** (sans accent) |

Si vous tapez **fiches-présence** (avec accent), vous êtes redirigé vers `/fiches-presence`.

## Sécurité / Production

- **Session** : définir `SESSION_SECRET` dans l'environnement pour un secret de session personnalisé.
- **Seed employés** : le chargement de la liste type (bouton « Monter la liste des employés » ou `/api/seed-employees`) nécessite d'être connecté.

## Fichiers importants

- `server.js` : serveur Express et routes
- `db.js` : schéma SQLite (users, employees, presence, fiche_presence)
- `lib/badge-pdf.js` : génération des badges PDF
- `views/` : pages (login, dashboard, employés, badges, scanner, présences, fiches de présence)
- `public/` : CSS, JS (scanner QR)
- `logo.png` : logo à la racine
- `scripts/seed-employees.js` : import des employés (exécuter une fois : `node scripts/seed-employees.js`)

## Base de données

- Fichier : `presence.db` (SQLite)
- Tables : `users`, `employees`, `presence`, `fiche_presence`

PresenceAris — Gestion des présences © ARIS CONCEPT
