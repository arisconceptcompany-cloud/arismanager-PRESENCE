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
try { db.exec(`ALTER TABLE employee_users ADD COLUMN email TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE employee_users ADD COLUMN is_verified INTEGER DEFAULT 1`); } catch (_) {}
try { db.exec(`ALTER TABLE employee_users ADD COLUMN is_active INTEGER DEFAULT 1`); } catch (_) {}
try { db.exec(`ALTER TABLE employees ADD COLUMN last_seen DATETIME`); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS projets (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL, description TEXT, client TEXT, date_debut TEXT, date_fin_prevue TEXT, statut TEXT DEFAULT 'en_cours', employes TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`); } catch (_) {}
try { db.exec(`ALTER TABLE projets ADD COLUMN created_by INTEGER`); } catch (_) {}

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

  CREATE TABLE IF NOT EXISTS employee_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER UNIQUE NOT NULL,
    email TEXT,
    password_hash TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    is_verified INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );
  CREATE INDEX IF NOT EXISTS idx_emp_user_employee ON employee_users(employee_id);

  CREATE TABLE IF NOT EXISTS email_verification (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    email TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );
  CREATE INDEX IF NOT EXISTS idx_email_verif_employee ON email_verification(employee_id);

  CREATE TABLE IF NOT EXISTS conges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    type_conge TEXT NOT NULL,
    date_debut TEXT NOT NULL,
    date_fin TEXT NOT NULL,
    jours_calcules INTEGER NOT NULL,
    motif TEXT,
    statut TEXT DEFAULT 'en_attente' CHECK(statut IN ('en_attente', 'approuve', 'rejete')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );

  CREATE TABLE IF NOT EXISTS salaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    mois INTEGER NOT NULL,
    annee INTEGER NOT NULL,
    salaire_base REAL NOT NULL,
    primes REAL DEFAULT 0,
    heures_supplementaires REAL DEFAULT 0,
    conge_annuel INTEGER DEFAULT 0,
    conge_maladie INTEGER DEFAULT 0,
    absences_non_justifiees INTEGER DEFAULT 0,
    retenue_absence REAL DEFAULT 0,
    autres_retenues REAL DEFAULT 0,
    cnaps REAL DEFAULT 0,
    ostie REAL DEFAULT 0,
    irsa REAL DEFAULT 0,
    salaire_net REAL NOT NULL,
    statut TEXT DEFAULT 'brouillon' CHECK(statut IN ('brouillon', 'valide', 'paye')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    UNIQUE(employee_id, mois, annee)
  );
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
