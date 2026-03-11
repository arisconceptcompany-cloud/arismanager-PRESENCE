const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'presence.db'));

// Schéma
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    badge_id TEXT UNIQUE NOT NULL,
    id_affichage INTEGER,
    nom TEXT NOT NULL,
    prenom TEXT NOT NULL,
    poste TEXT,
    departement TEXT,
    email TEXT,
    adresse TEXT,
    telephone TEXT,
    photo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
// Migration: ajouter colonnes si ancienne base
try {
  db.exec(`ALTER TABLE employees ADD COLUMN id_affichage INTEGER`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE employees ADD COLUMN adresse TEXT`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE employees ADD COLUMN telephone TEXT`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE employees ADD COLUMN photo TEXT`);
} catch (_) {}
try { db.exec(`ALTER TABLE employees ADD COLUMN equipe TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE employees ADD COLUMN date_naissance TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE employees ADD COLUMN date_embauche TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE employees ADD COLUMN categorie TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE employees ADD COLUMN cin TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE employees ADD COLUMN num_cnaps TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE employees ADD COLUMN mdp_mail TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN telephone TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN callmebot_apikey TEXT`); } catch (_) {}
db.exec(`

  CREATE TABLE IF NOT EXISTS presence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('entrer', 'sortie')),
    scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );

  CREATE INDEX IF NOT EXISTS idx_presence_employee ON presence(employee_id);
  CREATE INDEX IF NOT EXISTS idx_presence_scanned ON presence(scanned_at);
  CREATE INDEX IF NOT EXISTS idx_employees_badge ON employees(badge_id);

  CREATE TABLE IF NOT EXISTS fiche_presence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titre TEXT NOT NULL,
    mois INTEGER NOT NULL,
    annee INTEGER NOT NULL,
    donnees TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone);
  CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);
`);

// Utilisateur admin par défaut (mot de passe: admin123)
const bcrypt = require('bcryptjs');
const adminHash = bcrypt.hashSync('admin123', 10);
db.prepare(`
  INSERT OR IGNORE INTO users (username, password_hash, role)
  VALUES ('admin', ?, 'admin')
`).run(adminHash);
// Lier le numéro WhatsApp pour l'admin (configurer callmebot_apikey dans Paramètres)
db.prepare(`UPDATE users SET telephone = '+261 34 96 856 72' WHERE username = 'admin' AND (telephone IS NULL OR telephone = '')`).run();
// Utilisateur scanner (mot de passe: scanner123) — redirigé vers /scanner
const scannerHash = bcrypt.hashSync('scanner123', 10);
db.prepare(`
  INSERT OR IGNORE INTO users (username, password_hash, role)
  VALUES ('scanner', ?, 'scanner')
`).run(scannerHash);

module.exports = db;
