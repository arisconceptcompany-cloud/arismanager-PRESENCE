// Load .env file FIRST before anything else
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#') && line.includes('=')) {
      const [key, ...valueParts] = line.split('=');
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

const express = require('express');
const session = require('express-session');
const https = require('https');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const multer = require('multer');
const XLSX = require('xlsx');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const db = require('./db');
const { generateBadgePdf, generateBadgePdfFromTemplate } = require('./lib/badge-pdf');
const { sendWhatsAppOTP, normalizePhone } = require('./lib/whatsapp');
const EventEmitter = require('events');
const notificationEmitter = new EventEmitter();
const notifications = [];

const EMAIL_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
};

let emailTransporter = null;

function initEmailTransporter() {
  if (EMAIL_CONFIG.auth.user && EMAIL_CONFIG.auth.pass) {
    emailTransporter = nodemailer.createTransport({
      host: EMAIL_CONFIG.host,
      port: EMAIL_CONFIG.port,
      secure: EMAIL_CONFIG.secure,
      auth: {
        user: EMAIL_CONFIG.auth.user,
        pass: EMAIL_CONFIG.auth.pass
      }
    });
    console.log('[EMAIL] Transporteur configuré avec SMTP:', EMAIL_CONFIG.host);
  } else {
    console.log('[EMAIL] Configuration SMTP non définie - emails en mode simulation');
  }
}

async function sendRealEmail(to, subject, html) {
  console.log('[EMAIL] sendRealEmail called');
  console.log('[EMAIL] transporter exists:', !!emailTransporter);
  
  if (!emailTransporter) {
    console.log('[EMAIL] Transporteur non configuré');
    return false;
  }
  
  try {
    console.log('[EMAIL] Tentative envoi à:', to);
    const mailOptions = {
      from: `"ARIS Concept Company" <${EMAIL_CONFIG.auth.user}>`,
      to: to,
      subject: subject,
      html: html
    };
    
    const info = await emailTransporter.sendMail(mailOptions);
    console.log('[EMAIL] Envoyé:', info.messageId);
    return true;
  } catch (error) {
    console.error('[EMAIL] Erreur:', error.message);
    return false;
  }
}

const cors = require('cors');
const corsOptions = {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
};

const MAX_NOTIFICATIONS = 50;

function addNotification(type, data) {
  let message = '';
  
  switch (type) {
    case 'entrer':
      message = `Arrivée de ${data.prenom} ${data.nom}`;
      break;
    case 'sortie':
      message = `Sortie de ${data.prenom} ${data.nom}`;
      break;
    case 'conge_demande':
      message = `Nouvelle demande de congé: ${data.prenom} ${data.nom} (${data.type_conge} du ${data.date_debut} au ${data.date_fin})`;
      break;
    case 'conge_approuve':
      message = `Congé approuvé: ${data.prenom} ${data.nom} (${data.type_conge})`;
      break;
    case 'conge_rejete':
      message = `Congé rejeté: ${data.prenom} ${data.nom} (${data.type_conge})`;
      break;
    case 'projet_cree':
      message = `Nouveau projet créé: ${data.nom} par ${data.prenom} ${data.nom}`;
      break;
    case 'projet_modifie':
      message = `Projet modifié: ${data.nom} par ${data.prenom} ${data.nom}`;
      break;
    case 'projet_supprime':
      message = `Projet supprimé: ${data.nom} par ${data.prenom} ${data.nom}`;
      break;
    default:
      message = `Notification: ${type}`;
  }
  
  const notification = {
    id: Date.now(),
    type,
    data,
    message,
    time: new Date().toISOString()
  };
  notifications.unshift(notification);
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications.pop();
  }
  notificationEmitter.emit('pointage', notification);
}

const PHOTOS_DIR = path.join(__dirname, 'photos');
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PHOTOS_DIR),
  filename: (req, file, cb) => {
    const employeeId = req.params.id;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `emp_${employeeId}${ext}`);
  }
});

const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: 5 * 1024 * 1024 } 
});

const uploadPhoto = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Seules les images sont autorisées'));
    }
  }
});

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors(corsOptions));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/logo.png', (req, res) => {
  const logoPath = path.join(__dirname, 'logo.png');
  if (!fs.existsSync(logoPath)) {
    res.status(404).type('png').send(Buffer.alloc(0));
    return;
  }
  res.sendFile(logoPath);
});
const badgePdfPath = path.join(__dirname, 'Badge.pdf');
app.get('/Badge.pdf', (req, res) => {
  if (fs.existsSync(badgePdfPath)) {
    res.sendFile(badgePdfPath);
  } else {
    res.status(404).send('Badge.pdf non trouvé. Placez le fichier Badge.pdf à la racine du projet.');
  }
});
app.use('/photos', express.static(PHOTOS_DIR));

app.get('/photos/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(PHOTOS_DIR, filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'Photo non trouvée' });
  }
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'presence-aris-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    if (req.headers.accept?.includes('application/json') || req.xhr) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    return res.redirect('/login');
  }
  if (!req.session.role && req.session.userId) {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (u) req.session.role = u.role;
  }
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    if (req.headers.accept?.includes('application/json') || req.xhr) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    return res.redirect('/login');
  }
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || user.role !== 'admin') {
    if (req.headers.accept?.includes('application/json') || req.xhr) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    return res.redirect('/');
  }
  next();
}

// ---------- Interface Employé (Scan Badge) ----------
app.get('/employe-login', (req, res) => {
  if (req.session.employeId) return res.redirect('/employe');
  res.render('employe-login', { error: null });
});

app.post('/employe-login', (req, res) => {
  const { code } = req.body || {};
  if (!code) {
    return res.render('employe-login', { error: 'Veuillez entrer votre code' });
  }
  const employe = db.prepare('SELECT * FROM employees WHERE badge_id = ? OR id_affichage = ?').get(code, code);
  if (!employe) {
    return res.render('employe-login', { error: 'Code invalide' });
  }
  req.session.employeId = employe.id;
  req.session.employeName = employe.prenom + ' ' + employe.nom;
  res.redirect('/employe');
});

// ---------- Interface Responsable Scan (Login) ----------
app.get('/scan-login', (req, res) => {
  if (req.session.scanUserId) return res.redirect('/scan');
  res.render('scan-login', { error: null });
});

app.post('/scan-login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('scan-login', { error: 'Identifiants incorrects' });
  }
  req.session.scanUserId = user.id;
  req.session.scanUserName = user.username;
  res.redirect('/scan');
});

app.get('/scan', (req, res) => {
  if (!req.session.scanUserId) return res.redirect('/scan-login');
  res.render('scan-dashboard', { user: req.session });
});

app.post('/api/scan-badge', (req, res) => {
  if (!req.session.scanUserId) {
    return res.json({ ok: false, error: 'Non connecté' });
  }
  
  const { badgeCode } = req.body || {};
  if (!badgeCode) {
    return res.json({ ok: false, error: 'Code badge requis' });
  }
  
  const employe = db.prepare('SELECT * FROM employees WHERE badge_id = ? OR id_affichage = ?').get(badgeCode, badgeCode);
  if (!employe) {
    return res.json({ ok: false, error: 'Employé non trouvé', type: 'invalide' });
  }

  // Use UTC for consistent time handling
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // On vérifie le dernier scan de l'employé pour AUJOURD'HUI
  const lastPresence = db.prepare(`
    SELECT * FROM presence 
    WHERE employee_id = ? 
    AND date(scanned_at) = ?
    ORDER BY scanned_at DESC LIMIT 1
  `).get(employe.id, today);
  
  const type = (lastPresence && lastPresence.type === 'entrer') ? 'sortie' : 'entrer';
  
  // Insertion avec l'heure locale du serveur
  const localTime = now.getFullYear() + '-' + 
    String(now.getMonth() + 1).padStart(2, '0') + '-' + 
    String(now.getDate()).padStart(2, '0') + ' ' + 
    String(now.getHours()).padStart(2, '0') + ':' + 
    String(now.getMinutes()).padStart(2, '0') + ':' + 
    String(now.getSeconds()).padStart(2, '0');
  db.prepare('INSERT INTO presence (employee_id, type, scanned_at) VALUES (?, ?, ?)').run(employe.id, type, localTime);
  
  notificationEmitter.emit('pointage', {
    type: type,
    employe: { id: employe.id, nom: employe.nom, prenom: employe.prenom }
  });
  addNotification(type, { id: employe.id, nom: employe.nom, prenom: employe.prenom });
  
  res.json({ 
    ok: true, 
    type,
    employe: {
      id: employe.id,
      nom: employe.nom,
      prenom: employe.prenom,
      poste: employe.poste,
      photo: employe.photo || null,
      badge_id: employe.badge_id,
      id_affichage: employe.id_affichage
    }
  });
});
app.get('/scan-logout', (req, res) => {
  req.session.scanUserId = null;
  req.session.scanUserName = null;
  res.redirect('/scan-login');
});

// Scanner password change
app.get('/scan-password', (req, res) => {
  if (!req.session.scanUserId) return res.redirect('/scan-login');
  res.render('scan-password', { user: req.session, error: null, success: null });
});

// Scanner: view presences by date
app.get('/scan-presences', (req, res) => {
  if (!req.session.scanUserId) return res.redirect('/scan-login');
  
  const now = new Date();
  const date = req.query.date || now.toISOString().split('T')[0];
  const presences = db.prepare(`
    SELECT p.*, e.badge_id, e.nom, e.prenom, e.poste
    FROM presence p
    JOIN employees e ON e.id = p.employee_id
    WHERE date(p.scanned_at) = ?
    ORDER BY p.scanned_at DESC
  `).all(date);
  
  const totalEmployees = db.prepare('SELECT COUNT(*) as c FROM employees').get().c;
  const presentToday = db.prepare(`
    SELECT COUNT(DISTINCT employee_id) as c FROM presence
    WHERE date(scanned_at) = ? AND type = 'entrer'
  `).get(date).c;
  
  res.render('scan-presences', {
    user: req.session,
    presences,
    date,
    presentToday,
    totalEmployees,
    absentToday: totalEmployees - presentToday
  });
});

app.post('/scan-password', (req, res) => {
  if (!req.session.scanUserId) return res.redirect('/scan-login');
  
  const { current_password, new_password, confirm_password } = req.body || {};
  
  if (new_password !== confirm_password) {
    return res.render('scan-password', { user: req.session, error: 'Les mots de passe ne correspondent pas', success: null });
  }
  
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.scanUserId);
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
    return res.render('scan-password', { user: req.session, error: 'Mot de passe actuel incorrect', success: null });
  }
  
  const newHash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.session.scanUserId);
  
  res.render('scan-password', { user: req.session, error: null, success: 'Mot de passe modifié avec succès!' });
});

// API: Today's presences
app.get('/api/today-presences', (req, res) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const presences = db.prepare(`
    SELECT p.*, e.nom, e.prenom, e.poste, e.badge_id
    FROM presence p
    JOIN employees e ON p.employee_id = e.id
    WHERE date(p.scanned_at) = ?
    ORDER BY p.scanned_at DESC
  `).all(today);
  res.json(presences);
});

// API: All employees with presence status
app.get('/api/employees-status', (req, res) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  // Get employees with accounts
  const employeesWithAccounts = db.prepare('SELECT employee_id FROM employee_users WHERE is_active = 1').all().map(e => e.employee_id);
  
  // Get all employees with last_seen for PC status
  const employees = db.prepare(`
    SELECT e.*, 
      (SELECT type FROM presence WHERE employee_id = e.id AND date(scanned_at) = ? ORDER BY scanned_at DESC LIMIT 1) as last_status
    FROM employees e
    ORDER BY e.nom, e.prenom
  `).all(today);
  
  // Transform to show current status
  // If last_status is 'entrer' → Présent
  // If last_status is 'sortie' → Sortie
  // If last_status is null (no scan today) → Absent
  // PC is considered online if last_seen is within 5 minutes AND employee has an account
  const pcOnlineThreshold = 5 * 60 * 1000; // 5 minutes
  const result = employees.map(emp => {
    let status = 'absent';
    if (emp.last_status === 'entrer') {
      status = 'present';
    } else if (emp.last_status === 'sortie') {
      status = 'sortie';
    }
    
    // Check if PC is online based on last_seen AND employee has an account
    let pcOnline = false;
    if (emp.last_seen && employeesWithAccounts.includes(emp.id)) {
      // Parse SQLite local time correctly (add timezone offset)
      const localOffset = now.getTimezoneOffset() * 60000;
      const lastSeenTime = new Date(emp.last_seen).getTime() - localOffset;
      const diff = now.getTime() - lastSeenTime;
      pcOnline = diff < pcOnlineThreshold && diff >= 0;
    }
    
    return {
      id: emp.id,
      nom: emp.nom,
      prenom: emp.prenom,
      poste: emp.poste,
      badge_id: emp.badge_id,
      departement: emp.departement,
      email: emp.email,
      telephone: emp.telephone,
      adresse: emp.adresse,
      equipe: emp.equipe,
      date_naissance: emp.date_naissance,
      date_embauche: emp.date_embauche,
      categorie: emp.categorie,
      cin: emp.cin,
      num_cnaps: emp.num_cnaps,
      status: status,
      isPresent: status === 'present',
      last_seen: emp.last_seen,
      pcOnline: pcOnline,
      hasAccount: employeesWithAccounts.includes(emp.id),
      photo: emp.photo || null
    };
  });
  
  res.json(result);
});

// SSE endpoint for admin scan interface (/scan)
app.get('/api/notifications/scan', (req, res) => {
  if (!req.session.scanUserId) {
    res.status(401).json({ error: 'Non autorisé' });
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const onNotification = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  notificationEmitter.on('pointage', onNotification);
  
  req.on('close', () => {
    notificationEmitter.off('pointage', onNotification);
  });
});

// SSE endpoint for user scanner interface (/scanner)
app.get('/api/notifications/scanner', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const onNotification = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  notificationEmitter.on('pointage', onNotification);
  
  req.on('close', () => {
    notificationEmitter.off('pointage', onNotification);
  });
});

// Legacy endpoint - redirect to scan notifications
app.get('/api/notifications', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const onNotification = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  notificationEmitter.on('pointage', onNotification);
  
  req.on('close', () => {
    notificationEmitter.off('pointage', onNotification);
  });
});

// API: Get stored notifications
app.get('/api/notifications/list', requireAuth, (req, res) => {
  res.json(notifications);
});

// API: Public SSE endpoint for admin dashboard
app.get('/api/sse/dashboard', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const onNotification = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  notificationEmitter.on('pointage', onNotification);
  
  req.on('close', () => {
    notificationEmitter.off('pointage', onNotification);
  });
});

// API: Public today's presences for dashboard
app.get('/api/dashboard/presences', (req, res) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const presences = db.prepare(`
    SELECT p.*, e.nom, e.prenom, e.poste, e.badge_id, e.photo
    FROM presence p
    JOIN employees e ON p.employee_id = e.id
    WHERE date(p.scanned_at) = ?
    ORDER BY p.scanned_at DESC
  `).all(today);
  res.json(presences);
});

// API: Get presences by date
app.get('/api/presences/:date', (req, res) => {
  const { date } = req.params;
  const presences = db.prepare(`
    SELECT p.*, e.nom, e.prenom, e.poste, e.badge_id, e.photo
    FROM presence p
    JOIN employees e ON p.employee_id = e.id
    WHERE date(p.scanned_at) = ?
    ORDER BY p.scanned_at DESC
  `).all(date);
  res.json(presences);
});

// API: Dashboard stats
app.get('/api/dashboard/stats', (req, res) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  const totalEmployees = db.prepare('SELECT COUNT(*) as c FROM employees').get().c;
  const presentToday = db.prepare(`
    SELECT COUNT(DISTINCT employee_id) as c FROM presence
    WHERE date(scanned_at) = ? AND type = 'entrer'
  `).get(today).c;
  
  const lastScan = db.prepare(`
    SELECT p.*, e.nom, e.prenom, e.poste
    FROM presence p
    JOIN employees e ON p.employee_id = e.id
    WHERE date(p.scanned_at) = ?
    ORDER BY p.scanned_at DESC
    LIMIT 1
  `).get(today);
  
  res.json({
    totalEmployees,
    presentToday,
    absentToday: totalEmployees - presentToday,
    lastScan
  });
});

// API: Stats by date
app.get('/api/stats/:date', (req, res) => {
  const { date } = req.params;
  
  const totalEmployees = db.prepare('SELECT COUNT(*) as c FROM employees').get().c;
  const presentCount = db.prepare(`
    SELECT COUNT(DISTINCT employee_id) as c FROM presence
    WHERE date(scanned_at) = ? AND type = 'entrer'
  `).get(date).c;
  
  const sortieCount = db.prepare(`
    SELECT COUNT(DISTINCT employee_id) as c FROM presence
    WHERE date(scanned_at) = ? AND type = 'sortie'
  `).get(date).c;
  
  res.json({
    totalEmployees,
    presentToday: presentCount,
    sortieToday: sortieCount,
    absentToday: totalEmployees - presentCount
  });
});

// API: Clear notifications
app.post('/api/notifications/clear', requireAuth, (req, res) => {
  notifications.length = 0;
  res.json({ ok: true });
});

app.get('/employe', async (req, res) => {
  if (!req.session.employeId) return res.redirect('/employe-login');
  
  const employe = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.session.employeId);
  if (!employe) {
    req.session.employeId = null;
    return res.redirect('/employe-login');
  }
  
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const presences = db.prepare(`
    SELECT * FROM presence 
    WHERE employee_id = ? 
    AND date(scanned_at) = ?
    ORDER BY scanned_at DESC
  `).all(employe.id, today);
  
  const lastWeek = db.prepare(`
    SELECT date(scanned_at) as date, type, scanned_at
    FROM presence 
    WHERE employee_id = ?
    AND scanned_at >= datetime('now', '-7 days')
    ORDER BY scanned_at DESC
  `).all(employe.id);
  
  let qrDataUrl = null;
  try {
    qrDataUrl = await QRCode.toDataURL(String(employe.id_affichage || employe.id), { width: 250, margin: 2 });
  } catch (_) {}
  
  res.render('employe-dashboard', { 
    employe, 
    presences, 
    lastWeek, 
    qrDataUrl,
    today,
    hasPointedToday: presences.length > 0,
    lastPresence: presences[0] || null
  });
});

app.post('/employe-pointage', (req, res) => {
  if (!req.session.employeId) {
    return res.json({ ok: false, error: 'Non connecté' });
  }
  
  const employe = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.session.employeId);
  if (!employe) {
    return res.json({ ok: false, error: 'Employé non trouvé' });
  }
  
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const lastPresence = db.prepare(`
    SELECT * FROM presence 
    WHERE employee_id = ? 
    AND date(scanned_at) = ?
    ORDER BY scanned_at DESC LIMIT 1
  `).get(employe.id, today);
  
  const type = (lastPresence && lastPresence.type === 'entrer') ? 'sortie' : 'entrer';
  
  const now2 = new Date();
  const localTime = now2.getFullYear() + '-' + 
    String(now2.getMonth() + 1).padStart(2, '0') + '-' + 
    String(now2.getDate()).padStart(2, '0') + ' ' + 
    String(now2.getHours()).padStart(2, '0') + ':' + 
    String(now2.getMinutes()).padStart(2, '0') + ':' + 
    String(now2.getSeconds()).padStart(2, '0');
  db.prepare('INSERT INTO presence (employee_id, type, scanned_at) VALUES (?, ?, ?)').run(employe.id, type, localTime);
  
  notificationEmitter.emit('pointage', {
    type: type,
    employe: { id: employe.id, nom: employe.nom, prenom: employe.prenom }
  });
  addNotification(type, { id: employe.id, nom: employe.nom, prenom: employe.prenom });
  
  res.json({ ok: true, type });
});

app.get('/employe-logout', (req, res) => {
  req.session.employeId = null;
  req.session.employeName = null;
  res.redirect('/employe-login');
});

// ---------- Badge exemple (route prioritaire, sans auth, toujours répond) ----------
app.get('/badge-exemple', async (req, res) => {
  const adresseSociete = 'Lot II T 104 A lavoloha, Antananarivo 102';
  const exemple = { badge_id: 'ARIS-0001', id_affichage: 1, nom: 'RAHARISON', prenom: 'Michaël', poste: 'GERANT', adresse: adresseSociete, email: null, photo: null };
  let qrDataUrl = null;
  try {
    qrDataUrl = await QRCode.toDataURL(String(exemple.id_affichage), { width: 300, margin: 2 });
  } catch (_) {}
  try {
    return res.render('badge-fiche', { user: req.session || {}, employee: exemple, qrDataUrl, hasBadgePdfTemplate: false, adresseSociete, isExemple: true });
  } catch (err) {
    console.error('badge-exemple render:', err);
    res.status(500).send('Erreur affichage badge. Vérifiez les vues.');
  }
});

app.use((req, res, next) => {
  const p = (req.path || '').replace(/%C3%A9/g, '\u00e9');
  if ((p === '/fiches-pr\u00e9sence' || (req.originalUrl && req.originalUrl.indexOf('fiches-pr') !== -1 && req.originalUrl.indexOf('fiches-presence') === -1))) {
    return res.redirect(302, '/fiches-presence');
  }
  next();
});

// ---------- Auth ----------
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null, useOtp: false });
});

app.get('/login-scanner', (req, res) => {
  if (req.session.userId) {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    return res.redirect((u && u.role === 'scanner') ? '/scanner' : '/');
  }
  res.render('login-scanner', { error: null });
});
app.post('/login-scanner', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login-scanner', { error: 'Identifiants incorrects' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.redirect('/scanner');
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login', { error: 'Identifiants incorrects', useOtp: false });
  }

  // Si on saisit un compte "scanner" dans le login admin, basculer automatiquement
  // vers l'interface scan (sans ouvrir une session admin).
  if (user.role === 'scanner') {
    req.session.scanUserId = user.id;
    req.session.scanUserName = user.username;
    // Nettoyer l'éventuelle session admin
    req.session.userId = null;
    req.session.username = null;
    req.session.role = null;
    return res.redirect('/scan');
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.redirect('/');
});

function findUserByPhone(phone) {
  const clean = normalizePhone(phone);
  if (!clean) return null;
  const users = db.prepare('SELECT * FROM users WHERE telephone IS NOT NULL AND telephone != ""').all();
  return users.find(u => normalizePhone(u.telephone) === clean || normalizePhone(u.telephone).endsWith(clean.slice(-9)));
}

// Connexion par WhatsApp OTP — envoi au numéro configuré (sans afficher le numéro)
app.post('/api/login-request-otp', async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE telephone IS NOT NULL AND telephone != "" AND (callmebot_apikey IS NOT NULL AND callmebot_apikey != "")').get();
  if (!user) return res.json({ ok: false, error: 'WhatsApp non configuré. Configurez numéro et clé API dans Paramètres.' });
  const apikey = user.callmebot_apikey || process.env.CALLMEBOT_APIKEY;
  if (!apikey) return res.json({ ok: false, error: 'Clé API CallMeBot manquante. Configurez dans Paramètres.' });
  const phone = user.telephone;
  const clean = normalizePhone(phone);
  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(clean);
  db.prepare('INSERT INTO otp_codes (phone, code, expires_at) VALUES (?, ?, ?)').run(clean, code, expiresAt);
  try {
    await sendWhatsAppOTP(phone, code, apikey);
    res.json({ ok: true });
  } catch (err) {
    console.error('WhatsApp OTP:', err);
    res.json({ ok: false, error: 'Erreur d\'envoi WhatsApp. Vérifiez la clé API.' });
  }
});

app.post('/api/login-verify-otp', (req, res) => {
  const { code } = req.body || {};
  const codeStr = String(code || '').trim();
  if (!codeStr) return res.json({ ok: false, error: 'Code requis' });
  const row = db.prepare('SELECT * FROM otp_codes WHERE code = ? AND expires_at > datetime(\'now\') ORDER BY id DESC LIMIT 1').get(codeStr);
  if (!row) return res.json({ ok: false, error: 'Code incorrect ou expiré' });
  const user = findUserByPhone(row.phone);
  if (!user) return res.json({ ok: false, error: 'Utilisateur non trouvé' });
  db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(row.phone);

  if (user.role === 'scanner') {
    req.session.scanUserId = user.id;
    req.session.scanUserName = user.username;
    req.session.userId = null;
    req.session.username = null;
    req.session.role = null;
    return res.json({ ok: true, redirect: '/scan' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.json({ ok: true, redirect: '/' });
});

// Change password for admin
app.post('/api/admin/change-password', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.session.userId);

    res.json({ success: true, message: 'Mot de passe modifié avec succès' });
  } catch (e) {
    console.error('Password change error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ---------- Pages (protégées) ----------
app.get('/', requireAuth, (req, res) => {
  let empCount = db.prepare('SELECT COUNT(*) as c FROM employees').get().c;
  if (empCount === 0) {
    try { runSeedEmployees(); } catch (err) { console.error('Seed:', err); }
    empCount = db.prepare('SELECT COUNT(*) as c FROM employees').get().c;
  }
  const stats = {
    employees: db.prepare('SELECT COUNT(*) as c FROM employees').get().c,
    todayPresence: db.prepare(`
      SELECT COUNT(DISTINCT employee_id) as c FROM presence
      WHERE date(scanned_at) = date('now')
    `).get().c,
    lastPresences: db.prepare(`
      SELECT p.*, e.id as emp_id, e.id_affichage, e.badge_id, e.nom, e.prenom
      FROM presence p
      JOIN employees e ON e.id = p.employee_id
      ORDER BY p.scanned_at DESC
      LIMIT 10
    `).all()
  };
  const employees = db.prepare('SELECT id, id_affichage, badge_id, nom, prenom, poste FROM employees ORDER BY nom, prenom').all();
  res.render('dashboard', { user: req.session, stats, employees });
});

app.get('/parametres', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, role, telephone, callmebot_apikey FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.redirect('/login');
  const u = { ...req.session, ...user, userId: user.id };
  res.render('parametres', { user: u });
});
app.post('/parametres', requireAuth, (req, res) => {
  const { telephone, callmebot_apikey } = req.body || {};
  const tel = (telephone || '').trim();
  const key = (callmebot_apikey || '').trim();
  if (tel) {
    if (key) {
      db.prepare('UPDATE users SET telephone = ?, callmebot_apikey = ? WHERE id = ?').run(tel, key, req.session.userId);
    } else {
      db.prepare('UPDATE users SET telephone = ? WHERE id = ?').run(tel, req.session.userId);
    }
  }
  res.redirect('/parametres?saved=1');
});

// Changer mot de passe
app.post('/parametres/password', requireAuth, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body || {};
  
  if (new_password !== confirm_password) {
    const u = db.prepare('SELECT id, username, role, telephone, callmebot_apikey FROM users WHERE id = ?').get(req.session.userId);
    const userData = { ...req.session, ...u, userId: u.id };
    return res.render('parametres', { user: userData, pwderror: 'Les mots de passe ne correspondent pas' });
  }
  
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
    const u = db.prepare('SELECT id, username, role, telephone, callmebot_apikey FROM users WHERE id = ?').get(req.session.userId);
    const userData = { ...req.session, ...u, userId: u.id };
    return res.render('parametres', { user: userData, pwderror: 'Mot de passe actuel incorrect' });
  }
  
  const newHash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.session.userId);
  
  const u = db.prepare('SELECT id, username, role, telephone, callmebot_apikey FROM users WHERE id = ?').get(req.session.userId);
  const userData = { ...req.session, ...u, userId: u.id };
  res.render('parametres', { user: userData, pwdsaved: true });
});
// ---------- Utilisateurs (admin uniquement) ----------
app.get('/utilisateurs', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all();
  res.render('utilisateurs', { user: req.session, users });
});
app.get('/utilisateurs/nouveau', requireAdmin, (req, res) => {
  res.render('utilisateur-form', { user: req.session, editUser: null });
});
app.get('/utilisateurs/:id/modifier', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.redirect('/utilisateurs');
  res.render('utilisateur-form', { user: req.session, editUser: u });
});
app.post('/utilisateurs', requireAdmin, (req, res) => {
  const { username, password, role } = req.body || {};
  const u = (username || '').trim();
  const p = (password || '').trim();
  if (!u || !p) return res.redirect('/utilisateurs?error=1');
  const hash = bcrypt.hashSync(p, 10);
  try {
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(u, hash, role || 'user');
    res.redirect('/utilisateurs');
  } catch (e) {
    res.redirect('/utilisateurs?error=dup');
  }
});
app.post('/utilisateurs/:id', requireAdmin, (req, res) => {
  const { password, role } = req.body || {};
  const p = (password || '').trim();
  if (p) {
    const hash = bcrypt.hashSync(p, 10);
    db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?').run(hash, role || 'user', req.params.id);
  } else {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role || 'user', req.params.id);
  }
  res.redirect('/utilisateurs');
});
app.post('/utilisateurs/:id/supprimer', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ? AND username != ?').run(req.params.id, 'admin');
  res.redirect('/utilisateurs');
});
app.get('/employes', requireAuth, (req, res) => {
  const employees = db.prepare('SELECT * FROM employees ORDER BY nom, prenom').all();
  res.render('employes', { user: req.session, employees, imported: req.query.imported, import_error: req.query.import_error, error: req.query.error });
});

app.get('/employes/nouveau', requireAuth, (req, res) => {
  res.render('employe-form', { user: req.session, employee: null });
});

// ---------- REST API Employes ----------
app.get('/api/employes', requireAuth, (req, res) => {
  const employees = db.prepare('SELECT * FROM employees ORDER BY nom, prenom').all();
  res.json(employees);
});

app.get('/api/employes/:id', requireAuth, (req, res) => {
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!employee) return res.status(404).json({ error: 'Employé non trouvé' });
  res.json(employee);
});

app.put('/api/employes/:id', (req, res) => {
  const { nom, prenom, poste, departement, email, adresse, telephone, categorie } = req.body;
  try {
    db.prepare(`
      UPDATE employees SET nom=?, prenom=?, poste=?, departement=?, email=?, adresse=?, telephone=?, categorie=? WHERE id=?
    `).run(nom, prenom, poste || null, departement || null, email || null, adresse || null, telephone || null, categorie || null, req.params.id);
    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    res.json(employee);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/employes/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM presence WHERE employee_id = ?').run(req.params.id);
    db.prepare('DELETE FROM employee_users WHERE employee_id = ?').run(req.params.id);
    db.prepare('DELETE FROM email_verification WHERE employee_id = ?').run(req.params.id);
    db.prepare('DELETE FROM conges WHERE employee_id = ?').run(req.params.id);
    db.prepare('DELETE FROM salaries WHERE employee_id = ?').run(req.params.id);
    db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Employé supprimé définitivement' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/employes', (req, res) => {
  const { 
    badge_id, nom, prenom, email, telephone, adresse,
    poste, equipe, date_embauche, categorie,
    cin, num_cnaps, date_naissance
  } = req.body;
  
  if (!badge_id) {
    return res.status(400).json({ error: 'Le matricule est requis' });
  }
  
  if (!nom || !prenom) {
    return res.status(400).json({ error: 'Nom et prenom sont requis' });
  }
  
  // Normalize badge_id (add ARIS- prefix if not present)
  const normalizedBadge = badge_id.toUpperCase().startsWith('ARIS-') ? badge_id.toUpperCase() : 'ARIS-' + badge_id.toUpperCase();
  
  // Check if badge_id already exists
  const existing = db.prepare('SELECT id FROM employees WHERE badge_id = ?').get(normalizedBadge);
  if (existing) {
    return res.status(400).json({ error: 'Ce matricule existe déjà' });
  }
  
  // Extract numeric part for id_affichage
  const numericPart = normalizedBadge.replace('ARIS-', '').replace(/^0+/, '') || '1';
  const id_affichage = parseInt(numericPart) || 1;
  
  try {
    const result = db.prepare(`
      INSERT INTO employees (
        badge_id, id_affichage, nom, prenom, email, telephone, adresse,
        poste, departement, equipe, date_embauche, categorie,
        cin, num_cnaps, date_naissance
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalizedBadge, id_affichage, nom, prenom, email || null, telephone || null, adresse || null,
      poste || null, equipe || null, equipe || null, date_embauche || null, categorie || null,
      cin || null, num_cnaps || null, date_naissance || null
    );
    
    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(employee);
  } catch (e) {
    console.error('DB Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/employes/:id/modifier', requireAuth, (req, res) => {
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!employee) return res.redirect('/employes');
  res.render('employe-form', { user: req.session, employee });
});

app.post('/employes', requireAuth, (req, res) => {
  const { nom, prenom, poste, departement, email, adresse, telephone } = req.body;
  const badge_id = 'ARIS-' + Date.now().toString(36).toUpperCase();
  try {
    db.prepare(`
      INSERT INTO employees (badge_id, nom, prenom, poste, departement, email, adresse, telephone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(badge_id, nom, prenom, poste || null, departement || null, email || null, adresse || null, telephone || null);
    res.redirect('/employes');
  } catch (e) {
    res.redirect('/employes?error=1');
  }
});

app.post('/employes/:id', requireAuth, (req, res) => {
  const { nom, prenom, poste, departement, email, adresse, telephone } = req.body;
  db.prepare(`
    UPDATE employees SET nom=?, prenom=?, poste=?, departement=?, email=?, adresse=?, telephone=? WHERE id=?
  `).run(nom, prenom, poste || null, departement || null, email || null, adresse || null, telephone || null, req.params.id);
  res.redirect('/employes');
});

app.post('/employes/:id/supprimer', requireAuth, (req, res) => {
  db.prepare('DELETE FROM presence WHERE employee_id = ?').run(req.params.id);
  db.prepare('DELETE FROM employee_users WHERE employee_id = ?').run(req.params.id);
  db.prepare('DELETE FROM otp_codes WHERE employee_id = ?').run(req.params.id);
  db.prepare('DELETE FROM email_verification WHERE employee_id = ?').run(req.params.id);
  db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  if (req.headers.accept?.includes('application/json') || req.xhr) {
    res.json({ success: true, message: 'Employé supprimé définitivement' });
  } else {
    res.redirect('/employes');
  }
});

// ---------- Badges & QR ----------
app.get('/badges', requireAuth, (req, res) => {
  const employees = db.prepare('SELECT * FROM employees ORDER BY nom, prenom').all();
  res.render('badges', { user: req.session, employees });
});
const SEED_EMPLOYEES = [
  { id_affichage: 1, nom: 'RAHARISON', prenom: 'Michaël', equipe: 'Gérant', email: 'michael@aris-cc.com', mdp_mail: 'michael171102!', date_naissance: '10/11/1994', date_embauche: '5/12/2023', poste: 'GERANT', categorie: 'HC', adresse: 'Lot II B 128 TER Mahalavolona Andoharanofotsy 102', cin: '101.211.216.824', num_cnaps: '941110005606', telephone: '038 53 405 34' },
  { id_affichage: 2, nom: 'RASOANIRINA', prenom: 'Arlette', equipe: 'Agent de Sécurité', email: null, mdp_mail: null, date_naissance: '21/04/1977', date_embauche: '5/12/2023', poste: 'Sécurité', categorie: '2B', adresse: 'FA 243 TER Ambohimanatrika Mivoatra commune Tanjombato Antananarivo 102', cin: '210.012.012.871', num_cnaps: '772421000797', telephone: '034 75 819 13' },
  { id_affichage: 3, nom: 'RANAIVOARIMANANA', prenom: 'Ravakinionja Jean Valérie', equipe: 'Ingénieur BTP', email: 'onja@aris-cc.com', mdp_mail: 'onjabtp171102!', date_naissance: '08/02/1995', date_embauche: '2/1/2024', poste: 'Ingénieur BTP', categorie: 'HC', adresse: 'Lot TSF 505/A Antsahafohy Ambohitrimanjaka', cin: '103.131.015.114', num_cnaps: '950208004812', telephone: '033 05 059 33' },
  { id_affichage: 4, nom: 'RAZAFINDRAIBE', prenom: 'Harimalala Vololoniaina Annie', equipe: 'Ingénieur BTP', email: 'annie@aris-cc.com', mdp_mail: 'anniebtp171102!', date_naissance: '24/09/1996', date_embauche: '1/2/2024', poste: 'Ingénieur BTP', categorie: 'HC', adresse: 'III H 105 B BIS Avaratanana Antananarivo VI', cin: '101.982.094.987', num_cnaps: '962924004850', telephone: '034 25 903 79' },
  { id_affichage: 5, nom: 'RAHANTARIMALALA', prenom: 'Mamisoa Felicia', equipe: 'Assistant Technique', email: 'mamisoa@aris-cc.com', mdp_mail: 'mamisoa171102!', date_naissance: '02/10/1993', date_embauche: '12/4/2024', poste: 'TECHNICIEN ASSISTANT', categorie: '2B', adresse: 'III F 138 Antohomadinika Afovoany Antananarivo I', cin: '101.211.214.901', num_cnaps: '931002005967', telephone: '034 02 213 54' },
  { id_affichage: 7, nom: 'ANDRIANARISOA', prenom: 'Lalarimina Tahiry', equipe: 'Manager Google Maps', email: 'tahiry@aris-cc.com', mdp_mail: 'a1^9IM]HR&9U', date_naissance: '16/09/1995', date_embauche: '19/08/2024', poste: 'MANAGER CALL', categorie: 'HC', adresse: 'IC 189 TER D ANKADILALAMPOTSY ANKARAOBATO', cin: '101.252.184.456', num_cnaps: '952916002009', telephone: '032 52 771 41' },
  { id_affichage: 8, nom: 'FANOMEZANTSOA', prenom: 'Maminiaina Sarobidy', equipe: 'Technicien réseau', email: null, mdp_mail: null, date_naissance: '12/12/2002', date_embauche: '01/07/2025', poste: 'TECHNICIEN RESEAU', categorie: '2B', adresse: 'LOT IC 110 TER A ANKADILALAMPOTSY ANKARAOBATO', cin: '117.191.018.397', num_cnaps: '021212002606', telephone: '033 34 755 64' },
  { id_affichage: 10, nom: 'RASOAMBOLAMANANA', prenom: 'Aimée Eliane', equipe: 'Femme de ménage', email: null, mdp_mail: null, date_naissance: '08/06/1993', date_embauche: '25/09/2024', poste: 'FEMME DE MENAGE', categorie: '2B', adresse: 'II A 299 BIS K Tanjombato Iraitsimivaky Antananarivo 102', cin: '117.152.016.626', num_cnaps: '932608003092', telephone: '034 30 933 55' },
  { id_affichage: 12, nom: 'RAZANATSIMBA', prenom: 'Brigitte', equipe: 'Ebay', email: 'brigitterazanatsimba@aris-cc.com', mdp_mail: 'concept_rigi', date_naissance: '08/08/1980', date_embauche: '01/05/2025', poste: 'TELEOPERATEUR', categorie: '2B', adresse: 'II T 29 Ambohibao Iavoloha Bongatsara', cin: '117.392.002.118', num_cnaps: '802808003871', telephone: '034 95 432 10' },
];
function runSeedEmployees() {
  SEED_EMPLOYEES.forEach((e) => {
    const badge_id = 'ARIS-' + String(e.id_affichage).padStart(4, '0');
    const existing = db.prepare('SELECT id FROM employees WHERE badge_id = ?').get(badge_id);
    if (existing) {
      db.prepare('UPDATE employees SET id_affichage=?, nom=?, prenom=?, poste=?, departement=?, email=?, adresse=?, telephone=?, equipe=?, date_naissance=?, date_embauche=?, categorie=?, cin=?, num_cnaps=?, mdp_mail=? WHERE badge_id=?').run(e.id_affichage, e.nom, e.prenom, e.poste || null, e.equipe || null, e.email || null, e.adresse || null, e.telephone || null, e.equipe || null, e.date_naissance || null, e.date_embauche || null, e.categorie || null, e.cin || null, e.num_cnaps || null, e.mdp_mail || null, badge_id);
    } else {
      db.prepare('INSERT INTO employees (badge_id, id_affichage, nom, prenom, poste, departement, email, adresse, telephone, equipe, date_naissance, date_embauche, categorie, cin, num_cnaps, mdp_mail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(badge_id, e.id_affichage, e.nom, e.prenom, e.poste || null, e.equipe || null, e.email || null, e.adresse || null, e.telephone || null, e.equipe || null, e.date_naissance || null, e.date_embauche || null, e.categorie || null, e.cin || null, e.num_cnaps || null, e.mdp_mail || null);
    }
  });
}
function seedEmployees(req, res) {
  try {
    runSeedEmployees();
  } catch (err) {
    console.error('Seed employees:', err);
    return res.redirect('/?seed_error=1');
  }
  res.redirect('/employes');
}
// Seed employés (liste type) — accessible sans auth pour éviter "Impossible d'obtenir"
app.get('/api/seed-employees', seedEmployees);
app.get('/api/seed-eployes', seedEmployees);
app.post('/api/seed-employees', seedEmployees);
app.post('/api/seed-eployes', seedEmployees);

// Import employés depuis fichier Excel (.xlsx)
function mapExcelRow(row) {
  const get = (keys) => {
    for (const k of keys) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  };
  const id = get(['ID', 'id']);
  if (!id) return null;
  const idNum = parseInt(id, 10) || id;
  return {
    id_affichage: isNaN(idNum) ? null : idNum,
    nom: get(['NOM', 'Nom', 'nom']) || '',
    prenom: get(['PRENOM', 'Prénom', 'Prenom', 'prenom']) || '',
    poste: get(['FONCTION', 'Poste', 'poste', 'Fonction']),
    equipe: get(['Equipe', 'equipe', 'EQUIPE', 'Département', 'departement']),
    email: get(['MAIL', 'Mail', 'email', 'Email']),
    adresse: get(['HABITATION', 'Adresse', 'adresse', 'Habitation']),
    telephone: get(['TELEPHONE', 'Téléphone', 'telephone']),
    date_naissance: get(['DATE DE NAISSANCE', 'Date de naissance', 'date_naissance']),
    date_embauche: get(['DATE D EMBAUCHE', 'Date d\'embauche', 'date_embauche']),
    categorie: get(['CATEGORIE', 'Catégorie', 'categorie']),
    cin: get(['CIN', 'Cin']),
    num_cnaps: get(['NUM CNAPS', 'Num CNAPS', 'num_cnaps']),
    mdp_mail: get(['MDP MAIL', 'Mdp mail', 'mdp_mail'])
  };
}
app.post('/api/import-employees', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.redirect('/employes?import_error=no_file');
  }
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const firstSheet = wb.SheetNames[0];
    const ws = wb.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    let imported = 0;
    for (let i = 0; i < rows.length; i++) {
      const e = mapExcelRow(rows[i]);
      if (!e || !e.nom) continue;
      const num = (e.id_affichage != null && !isNaN(e.id_affichage)) ? e.id_affichage : (i + 1);
      const badge_id = 'ARIS-' + String(num).padStart(4, '0');
      const existing = db.prepare('SELECT id FROM employees WHERE badge_id = ?').get(badge_id);
      if (existing) {
        db.prepare('UPDATE employees SET id_affichage=?, nom=?, prenom=?, poste=?, departement=?, email=?, adresse=?, telephone=?, equipe=?, date_naissance=?, date_embauche=?, categorie=?, cin=?, num_cnaps=?, mdp_mail=? WHERE badge_id=?').run(e.id_affichage, e.nom, e.prenom, e.poste || null, e.equipe || null, e.email || null, e.adresse || null, e.telephone || null, e.equipe || null, e.date_naissance || null, e.date_embauche || null, e.categorie || null, e.cin || null, e.num_cnaps || null, e.mdp_mail || null, badge_id);
      } else {
        db.prepare('INSERT INTO employees (badge_id, id_affichage, nom, prenom, poste, departement, email, adresse, telephone, equipe, date_naissance, date_embauche, categorie, cin, num_cnaps, mdp_mail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(badge_id, e.id_affichage, e.nom, e.prenom, e.poste || null, e.equipe || null, e.email || null, e.adresse || null, e.telephone || null, e.equipe || null, e.date_naissance || null, e.date_embauche || null, e.categorie || null, e.cin || null, e.num_cnaps || null, e.mdp_mail || null);
      }
      imported++;
    }
    res.redirect('/employes?imported=' + imported);
  } catch (err) {
    console.error('Import Excel:', err);
    res.redirect('/employes?import_error=1');
  }
});

app.get('/badge/:badgeId/qr', async (req, res) => {
  try {
    const url = await QRCode.toDataURL(req.params.badgeId, { width: 300, margin: 2 });
    res.json({ qr: url });
  } catch (e) {
    res.status(400).json({ error: 'Badge invalide' });
  }
});

app.get('/api/employee/:id/qr-id', async (req, res) => {
  const employee = db.prepare('SELECT id, id_affichage, badge_id FROM employees WHERE id = ?').get(req.params.id);
  if (!employee) return res.status(404).json({ error: 'Employé non trouvé' });
  const qrContent = employee.id_affichage != null ? String(employee.id_affichage) : employee.badge_id;
  try {
    const url = await QRCode.toDataURL(qrContent, { width: 120, margin: 1 });
    res.json({ qr: url, id: qrContent });
  } catch (e) {
    res.status(500).json({ error: 'Erreur QR' });
  }
});

app.get('/badge/:badgeId/fiche', async (req, res) => {
  const employee = db.prepare('SELECT * FROM employees WHERE badge_id = ?').get(req.params.badgeId);
  if (!employee) return res.status(404).send('Employé non trouvé');
  const qrContent = employee.id_affichage != null ? String(employee.id_affichage) : employee.badge_id;
  let qrDataUrl = null;
  try {
    qrDataUrl = await QRCode.toDataURL(qrContent, { width: 300, margin: 2 });
  } catch (_) {}
  const hasBadgePdfTemplate = fs.existsSync(path.join(__dirname, 'Badge.pdf'));
  const adresseSociete = 'Lot II T 104 A lavoloha, Antananarivo 102';
  res.render('badge-fiche', { user: req.session, employee, qrDataUrl, hasBadgePdfTemplate, adresseSociete });
});

// Génération du badge au format PDF (nouveau design)
app.get('/badge/:badgeId/badge.pdf', async (req, res) => {
  const employee = db.prepare('SELECT * FROM employees WHERE badge_id = ?').get(req.params.badgeId);
  if (!employee) return res.status(404).send('Employé non trouvé');
  try {
    const adresseSociete = 'Lot II T 104 A lavoloha, Antananarivo 102';
    const pdfBytes = await generateBadgePdf(employee, 'logo.png', { adresseSociete });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="badge-${employee.badge_id}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur lors de la génération du badge PDF.');
  }
});

// ---------- Scanner (page publique pour enregistrer présence) ----------
app.get('/scanner', (req, res) => {
  res.render('scanner', { user: req.session });
});

app.post('/api/presence', (req, res) => {
  const { badge_id, id } = req.body || {};
  const raw = (badge_id != null ? badge_id : id);
  if (raw === undefined || raw === null || raw === '') {
    return res.status(400).json({ error: 'badge_id ou id requis' });
  }
  const str = String(raw).trim();
  let employee = null;
  const num = parseInt(str, 10);
  if (!isNaN(num)) {
    employee = db.prepare('SELECT * FROM employees WHERE id_affichage = ?').get(num);
  }
  if (!employee) {
    employee = db.prepare('SELECT * FROM employees WHERE badge_id = ?').get(str);
  }
  if (!employee) {
    return res.status(404).json({ error: 'Badge / ID non reconnu' });
  }
  const last = db.prepare(`
    SELECT type FROM presence WHERE employee_id = ? ORDER BY scanned_at DESC LIMIT 1
  `).get(employee.id);
  const nextType = (!last || last.type === 'sortie') ? 'entrer' : 'sortie';
  const now3 = new Date();
  const localTime = now3.getFullYear() + '-' + 
    String(now3.getMonth() + 1).padStart(2, '0') + '-' + 
    String(now3.getDate()).padStart(2, '0') + ' ' + 
    String(now3.getHours()).padStart(2, '0') + ':' + 
    String(now3.getMinutes()).padStart(2, '0') + ':' + 
    String(now3.getSeconds()).padStart(2, '0');
  db.prepare('INSERT INTO presence (employee_id, type, scanned_at) VALUES (?, ?, ?)').run(employee.id, nextType, localTime);
  
  notificationEmitter.emit('pointage', {
    type: nextType,
    employe: { id: employee.id, nom: employee.nom, prenom: employee.prenom }
  });
  
  res.json({
    ok: true,
    type: nextType,
    employee: { 
      id: employee.id,
      nom: employee.nom, 
      prenom: employee.prenom, 
      badge_id: employee.badge_id,
      poste: employee.poste,
      photo: employee.photo
    }
  });
});

// ---------- Présences par date ----------
app.get('/presences-par-date', requireAuth, (req, res) => {
  const now = new Date();
  const localOffset = now.getTimezoneOffset() * 60000;
  const localDate = new Date(now.getTime() - localOffset);
  const date = req.query.date || localDate.toISOString().split('T')[0];
  const filter = req.query.filter; // 'presents', 'absents', or 'sorties'
  
  const totalEmployees = db.prepare('SELECT COUNT(*) as c FROM employees').get().c;
  
  // Get employees who have entered (present)
  const presentEmployees = db.prepare(`
    SELECT DISTINCT employee_id FROM presence
    WHERE date(scanned_at) = ? AND type = 'entrer'
  `).all(date).map(p => p.employee_id);
  
  // Get employees who have both entered and left (sorted)
  const sortedEmployees = db.prepare(`
    SELECT DISTINCT employee_id FROM presence p1
    WHERE date(p1.scanned_at) = ?
    AND p1.type = 'sortie'
    AND EXISTS (
      SELECT 1 FROM presence p2 
      WHERE p2.employee_id = p1.employee_id 
      AND date(p2.scanned_at) = ? 
      AND p2.type = 'entrer'
      AND p2.scanned_at < p1.scanned_at
    )
  `).all(date, date).map(p => p.employee_id);
  
  const presentCount = presentEmployees.length;
  const sortieCount = sortedEmployees.length;
  const absentCount = totalEmployees - presentCount;
  
  let presences = [];
  let pageTitle = 'Pointages';
  let showPresenceList = false;
  
  if (filter === 'presents') {
    // Show list of present employees (those who entered but not left)
    const presentEmps = db.prepare(`
      SELECT e.*, p.scanned_at as last_scan, 'entrer' as last_type
      FROM employees e
      JOIN presence p ON p.employee_id = e.id
      WHERE date(p.scanned_at) = ? AND p.type = 'entrer'
      GROUP BY e.id
      ORDER BY p.scanned_at DESC
    `).all(date);
    
    presences = presentEmps.map(e => ({
      employee_id: e.id,
      nom: e.nom,
      prenom: e.prenom,
      poste: e.poste,
      badge_id: e.badge_id,
      type: 'entrer',
      scanned_at: e.last_scan,
      is_present_list: true
    }));
    pageTitle = 'Employés présents';
    showPresenceList = true;
  } else if (filter === 'sorties') {
    // Show list of sorted employees (those who entered and left)
    const sortedEmps = db.prepare(`
      SELECT e.*, MAX(p.scanned_at) as last_scan
      FROM employees e
      JOIN presence p ON p.employee_id = e.id
      WHERE date(p.scanned_at) = ? AND p.type = 'sortie'
      AND EXISTS (
        SELECT 1 FROM presence p2 
        WHERE p2.employee_id = e.id 
        AND date(p2.scanned_at) = ? 
        AND p2.type = 'entrer'
        AND p2.scanned_at < p.scanned_at
      )
      GROUP BY e.id
      ORDER BY last_scan DESC
    `).all(date, date);
    
    presences = sortedEmps.map(e => ({
      employee_id: e.id,
      nom: e.nom,
      prenom: e.prenom,
      poste: e.poste,
      badge_id: e.badge_id,
      type: 'sortie',
      scanned_at: e.last_scan,
      is_sorted_list: true
    }));
    pageTitle = 'Employés partis';
    showPresenceList = true;
  } else if (filter === 'absents') {
    // Show list of absent employees (those who didn't enter)
    const absentEmps = db.prepare(`
      SELECT * FROM employees e
      WHERE e.id NOT IN (SELECT DISTINCT employee_id FROM presence WHERE date(scanned_at) = ? AND type = 'entrer')
      ORDER BY e.nom, e.prenom
    `).all(date);
    
    presences = absentEmps.map(e => ({
      employee_id: e.id,
      nom: e.nom,
      prenom: e.prenom,
      poste: e.poste,
      badge_id: e.badge_id,
      type: null,
      scanned_at: null,
      is_absent_list: true
    }));
    pageTitle = 'Employés absents';
    showPresenceList = true;
  } else {
    // Show all presences (pointages)
    presences = db.prepare(`
      SELECT p.*, e.badge_id, e.nom, e.prenom, e.poste
      FROM presence p
      JOIN employees e ON e.id = p.employee_id
      WHERE date(p.scanned_at) = ?
      ORDER BY p.scanned_at DESC
    `).all(date);
  }
  
  res.render('presences-par-date', {
    user: req.session,
    presences,
    date,
    presentToday: presentCount,
    sortieToday: sortieCount,
    totalEmployees,
    absentToday: absentCount,
    filter,
    pageTitle,
    showPresenceList
  });
});

// ---------- Présences (historique) ----------
app.get('/presences', requireAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 50;
  const now = new Date();
  const localOffset = now.getTimezoneOffset() * 60000;
  const localDate = new Date(now.getTime() - localOffset);
  const today = localDate.toISOString().split('T')[0];
  const dateFilter = req.query.date || today;
  
  let whereClause = '';
  let params = [];
  
  if (dateFilter) {
    whereClause = "WHERE DATE(p.scanned_at) = ?";
    params.push(dateFilter);
  }
  
  const total = db.prepare('SELECT COUNT(*) as c FROM presence p ' + whereClause).get(...params).c;
  
  let query = `
    SELECT p.*, e.badge_id, e.nom, e.prenom
    FROM presence p
    JOIN employees e ON e.id = p.employee_id
    ${whereClause}
    ORDER BY e.badge_id ASC, p.scanned_at ASC
  `;
  
  if (dateFilter) {
    params.push(perPage, (page - 1) * perPage);
    query += ' LIMIT ? OFFSET ?';
  } else {
    query += ' LIMIT ? OFFSET ?';
    params.push(perPage, (page - 1) * perPage);
  }
  
  const presences = db.prepare(query).all(...params);
  res.render('presences', {
    user: req.session,
    presences,
    page,
    totalPages: Math.ceil(total / perPage),
    total,
    dateFilter,
    today
  });
});

app.get('/api/presences/export', requireAuth, (req, res) => {
  const now = new Date();
  const localOffset = now.getTimezoneOffset() * 60000;
  const localDate = new Date(now.getTime() - localOffset);
  const today = localDate.toISOString().split('T')[0];
  const dateFilter = req.query.date || today;
  
  let whereClause = '';
  let params = [];
  
  if (dateFilter) {
    whereClause = "WHERE DATE(p.scanned_at) = ?";
    params.push(dateFilter);
  }
  
  const presences = db.prepare(`
    SELECT p.scanned_at, p.type, e.badge_id, e.nom, e.prenom
    FROM presence p
    JOIN employees e ON e.id = p.employee_id
    ${whereClause}
    ORDER BY e.badge_id ASC, p.scanned_at ASC
  `).all(...params);
  res.setHeader('Content-Type', 'application/json');
  const filename = dateFilter ? `presences-${dateFilter}.json` : 'presences.json';
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.send(JSON.stringify(presences, null, 2));
});

// ---------- Fiches de présence (imprimables, auto-sauvegarde) ----------
const MOIS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
app.get('/fiches-presence', requireAuth, (req, res) => {
  const fiches = db.prepare('SELECT * FROM fiche_presence ORDER BY annee DESC, mois DESC').all();
  res.render('fiches-presence-list', { user: req.session, fiches, MOIS, error: req.query.error });
});
app.get('/fiches-presence/nouvelle', requireAuth, (req, res) => {
  const d = new Date();
  res.render('fiches-presence-new', { user: req.session, mois: d.getMonth() + 1, annee: d.getFullYear(), MOIS });
});
app.post('/fiches-presence', requireAuth, (req, res) => {
  const { titre, mois, annee } = req.body || {};
  const m = parseInt(mois, 10); const a = parseInt(annee, 10);
  if (!titre || !m || !a) return res.redirect('/fiches-presence?error=1');
  const titreNorm = titre.trim() || `${MOIS[m - 1]} ${a}`;
  db.prepare('INSERT INTO fiche_presence (titre, mois, annee, donnees) VALUES (?, ?, ?, ?)').run(titreNorm, m, a, '{}');
  const row = db.prepare('SELECT id FROM fiche_presence ORDER BY id DESC LIMIT 1').get();
  res.redirect('/fiches-presence/' + row.id);
});
app.get('/fiches-presence/:id', requireAuth, (req, res) => {
  const fiche = db.prepare('SELECT * FROM fiche_presence WHERE id = ?').get(req.params.id);
  if (!fiche) return res.redirect('/fiches-presence');
  const employees = db.prepare('SELECT id, badge_id, nom, prenom, poste FROM employees ORDER BY nom, prenom').all();
  const jours = new Date(fiche.annee, fiche.mois, 0).getDate();
  const donnees = (fiche.donnees && fiche.donnees !== '{}') ? JSON.parse(fiche.donnees) : {};
  res.render('fiche-presence', {
    user: req.session,
    fiche,
    employees,
    jours: Array.from({ length: jours }, (_, i) => i + 1),
    donnees,
    MOIS
  });
});
app.patch('/api/fiches-presence/:id', requireAuth, (req, res) => {
  const fiche = db.prepare('SELECT id FROM fiche_presence WHERE id = ?').get(req.params.id);
  if (!fiche) return res.status(404).json({ error: 'Fiche non trouvée' });
  const { donnees } = req.body || {};
  const json = typeof donnees === 'string' ? donnees : JSON.stringify(donnees || {});
  db.prepare('UPDATE fiche_presence SET donnees = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(json, req.params.id);
  res.json({ ok: true });
});

// ---------- Fiche de présence manuelle (imprimable, employés Aris Concept, jours ouvrables) ----------
function getJoursOuvrables(mois, annee) {
  const jours = [];
  const n = new Date(annee, mois, 0).getDate();
  for (let j = 1; j <= n; j++) {
    const d = new Date(annee, mois - 1, j);
    if (d.getDay() >= 1 && d.getDay() <= 5) jours.push({ jour: j });
  }
  return jours;
}
app.get('/fiche-presence-manuelle', requireAuth, (req, res) => {
  const d = new Date();
  let mois = parseInt(req.query.mois, 10) || (d.getMonth() + 1);
  let annee = parseInt(req.query.annee, 10) || d.getFullYear();
  mois = Math.max(1, Math.min(12, mois || 1));
  annee = Math.max(2020, Math.min(2030, annee || d.getFullYear()));
  const employees = db.prepare(`
    SELECT id, id_affichage, badge_id, nom, prenom
    FROM employees
    WHERE badge_id LIKE 'ARIS-%'
    ORDER BY id_affichage, nom, prenom
  `).all();
  const joursOuvrables = getJoursOuvrables(mois, annee);
  const MOIS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const moisLabel = MOIS[mois - 1] + ' ' + annee;
  res.render('fiche-presence-manuelle', {
    user: req.session,
    employees,
    joursOuvrables,
    mois,
    annee,
    moisLabel
  });
});

// ---------- Congés API ----------
const TYPES_CONGE = ['Congé annuel', 'Congé maladie', 'Congé sans solde', 'Congé maternite', 'Congé paternite'];

app.get('/api/conges', (req, res) => {
  const conges = db.prepare(`
    SELECT c.*, e.nom, e.prenom, e.poste, e.badge_id
    FROM conges c
    JOIN employees e ON e.id = c.employee_id
    ORDER BY c.created_at DESC
  `).all();
  res.json(conges);
});

app.get('/api/conges/pending', (req, res) => {
  const conges = db.prepare(`
    SELECT c.*, e.nom, e.prenom, e.poste, e.badge_id
    FROM conges c
    JOIN employees e ON e.id = c.employee_id
    WHERE c.statut = 'en_attente'
    ORDER BY c.created_at DESC
  `).all();
  res.json(conges);
});

app.get('/api/conges/actifs', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const actifs = db.prepare(`
    SELECT c.*, e.nom, e.prenom, e.badge_id
    FROM conges c
    JOIN employees e ON e.id = c.employee_id
    WHERE c.statut = 'approuve'
    AND c.date_debut <= ?
    AND c.date_fin >= ?
    ORDER BY c.date_fin ASC
  `).all(today, today);
  res.json(actifs);
});

app.get('/api/conges/:id', (req, res) => {
  const conge = db.prepare(`
    SELECT c.*, e.nom, e.prenom, e.poste, e.badge_id
    FROM conges c
    JOIN employees e ON e.id = c.employee_id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!conge) return res.status(404).json({ error: 'Congé non trouvé' });
  res.json(conge);
});

app.post('/api/conges', (req, res) => {
  const { employee_id, type_conge, date_debut, date_fin, motif } = req.body;
  if (!employee_id || !type_conge || !date_debut || !date_fin) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }
  
  const debut = new Date(date_debut);
  const fin = new Date(date_fin);
  if (fin < debut) {
    return res.status(400).json({ error: 'La date de fin doit être après la date de début' });
  }
  
  const jours_calcules = Math.ceil((fin - debut) / (1000 * 60 * 60 * 24)) + 1;
  
  const result = db.prepare(`
    INSERT INTO conges (employee_id, type_conge, date_debut, date_fin, jours_calcules, motif)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(employee_id, type_conge, date_debut, date_fin, jours_calcules, motif || null);
  
  const newConge = db.prepare('SELECT * FROM conges WHERE id = ?').get(result.lastInsertRowid);
  
  const employe = db.prepare('SELECT * FROM employees WHERE id = ?').get(employee_id);
  if (employe) {
    addNotification('conge_demande', { ...employe, type_conge, date_debut, date_fin });
  }
  
  res.json({ ok: true, conge: newConge });
});

app.patch('/api/conges/:id/approve', (req, res) => {
  const conge = db.prepare('SELECT * FROM conges WHERE id = ?').get(req.params.id);
  if (!conge) return res.status(404).json({ error: 'Congé non trouvé' });
  
  db.prepare("UPDATE conges SET statut = 'approuve', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  
  const employe = db.prepare('SELECT * FROM employees WHERE id = ?').get(conge.employee_id);
  if (employe) {
    addNotification('conge_approuve', { ...employe, type_conge: conge.type_conge });
  }
  
  res.json({ ok: true });
});

app.patch('/api/conges/:id/reject', (req, res) => {
  const conge = db.prepare('SELECT * FROM conges WHERE id = ?').get(req.params.id);
  if (!conge) return res.status(404).json({ error: 'Congé non trouvé' });
  
  db.prepare("UPDATE conges SET statut = 'rejete', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  
  const employe = db.prepare('SELECT * FROM employees WHERE id = ?').get(conge.employee_id);
  if (employe) {
    addNotification('conge_rejete', { ...employe, type_conge: conge.type_conge });
  }
  
  res.json({ ok: true });
});

app.delete('/api/conges/:id', (req, res) => {
  db.prepare('DELETE FROM conges WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/conges/:id', (req, res) => {
  db.prepare('DELETE FROM conges WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/conges/types', (req, res) => {
  res.json(TYPES_CONGE);
});

// ---------- Salaires API ----------
const SALAIRE_BASE_CATEGORIE = {
  'HC': 0,
  '2B': 0,
  '2A': 0,
  '1': 0,
  'default': 0
};

const TAUX_CNAPS = 0.01;
const TAUX_OSTIE = 0.01;

app.get('/api/salaries', (req, res) => {
  const { mois, annee } = req.query;
  let query = `
    SELECT s.*, e.nom, e.prenom, e.poste, e.badge_id, e.categorie
    FROM salaries s
    JOIN employees e ON e.id = s.employee_id
  `;
  const params = [];
  
  if (mois && annee) {
    query += ' WHERE s.mois = ? AND s.annee = ?';
    params.push(parseInt(mois), parseInt(annee));
  }
  
  query += ' ORDER BY s.annee DESC, s.mois DESC, e.nom';
  
  const salaries = db.prepare(query).all(...params);
  res.json(salaries);
});

app.get('/api/salaries/:employeeId/:mois/:annee', (req, res) => {
  const { employeeId, mois, annee } = req.params;
  const salary = db.prepare(`
    SELECT s.*, e.nom, e.prenom, e.poste, e.badge_id, e.categorie, e.date_embauche
    FROM salaries s
    JOIN employees e ON e.id = s.employee_id
    WHERE s.employee_id = ? AND s.mois = ? AND s.annee = ?
  `).get(employeeId, parseInt(mois), parseInt(annee));
  
  if (!salary) {
    return res.status(404).json({ error: 'Salaire non trouvé' });
  }
  res.json(salary);
});

app.post('/api/salaries/calculate', (req, res) => {
  const { employee_id, mois, annee } = req.body;
  
  if (!employee_id || !mois || !annee) {
    return res.status(400).json({ error: 'employee_id, mois et annee requis' });
  }
  
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employee_id);
  if (!employee) return res.status(404).json({ error: 'Employé non trouvé' });
  
  const salaireBase = SALAIRE_BASE_CATEGORIE[employee.categorie] || SALAIRE_BASE_CATEGORIE['default'];
  
  const existingSalary = db.prepare(`
    SELECT * FROM salaries WHERE employee_id = ? AND mois = ? AND annee = ?
  `).get(employee_id, parseInt(mois), parseInt(annee));
  
  let primes = existingSalary?.primes || 0;
  let heuresSup = existingSalary?.heures_supplementaires || 0;
  let autresRetenues = existingSalary?.autres_retenues || 0;
  
  const debutMois = `${annee}-${String(mois).padStart(2, '0')}-01`;
  const finMois = new Date(annee, mois, 0).toISOString().split('T')[0];
  
  const congeAnnuel = db.prepare(`
    SELECT COALESCE(SUM(jours_calcules), 0) as total FROM conges
    WHERE employee_id = ? AND type_conge = 'Congé annuel' AND statut = 'approuve'
    AND date_debut >= ? AND date_fin <= ?
  `).get(employee_id, debutMois, finMois).total;
  
  const congeMaladie = db.prepare(`
    SELECT COALESCE(SUM(jours_calcules), 0) as total FROM conges
    WHERE employee_id = ? AND type_conge = 'Congé maladie' AND statut = 'approuve'
    AND date_debut >= ? AND date_fin <= ?
  `).get(employee_id, debutMois, finMois).total;
  
  const joursMois = new Date(annee, mois, 0).getDate();
  const joursOuvres = Array.from({ length: joursMois }, (_, i) => new Date(annee, mois - 1, i + 1))
    .filter(d => d.getDay() >= 1 && d.getDay() <= 5).length;
  
  const presencesMois = db.prepare(`
    SELECT COUNT(DISTINCT DATE(scanned_at)) as jours FROM presence
    WHERE employee_id = ? AND date(scanned_at) >= ? AND date(scanned_at) <= ? AND type = 'entrer'
  `).get(employee_id, debutMois, finMois).jours;
  
  const absencesNonJustifiees = Math.max(0, joursOuvres - presencesMois - congeAnnuel - congeMaladie);
  const retenueAbsence = (salaireBase / joursOuvres) * absencesNonJustifiees;
  
  const salaireBrut = salaireBase + primes + heuresSup;
  const cnaps = salaireBrut * TAUX_CNAPS;
  const ostie = salaireBrut * TAUX_OSTIE;
  
  const netImposable = salaireBrut - cnaps - ostie;
  let irsa = 0;
  if (netImposable > 350000) {
    if (netImposable <= 400000) irsa = (netImposable - 350000) * 0.05;
    else if (netImposable <= 650000) irsa = 2500 + (netImposable - 400000) * 0.10;
    else if (netImposable <= 900000) irsa = 27500 + (netImposable - 650000) * 0.15;
    else if (netImposable <= 1300000) irsa = 65000 + (netImposable - 900000) * 0.20;
    else irsa = 145000 + (netImposable - 1300000) * 0.25;
  }
  
  const salaireNet = salaireBrut - cnaps - ostie - irsa - retenueAbsence - autresRetenues;
  
  db.prepare(`
    INSERT OR REPLACE INTO salaries 
    (employee_id, mois, annee, salaire_base, primes, heures_supplementaires, conge_annuel, conge_maladie, absences_non_justifiees, retenue_absence, autres_retenues, cnaps, ostie, irsa, salaire_net, statut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'valide')
  `).run(employee_id, parseInt(mois), parseInt(annee), salaireBase, primes, heuresSup, congeAnnuel, congeMaladie, absencesNonJustifiees, retenueAbsence, autresRetenues, cnaps, ostie, irsa, salaireNet);
  
  const salary = db.prepare(`
    SELECT s.*, e.nom, e.prenom, e.poste, e.badge_id, e.categorie
    FROM salaries s
    JOIN employees e ON e.id = s.employee_id
    WHERE s.employee_id = ? AND s.mois = ? AND s.annee = ?
  `).get(employee_id, parseInt(mois), parseInt(annee));
  
  res.json({ ok: true, salary });
});

app.post('/api/salaries/generate-month', (req, res) => {
  const { mois, annee } = req.body;
  
  if (!mois || !annee) {
    return res.status(400).json({ error: 'mois et annee requis' });
  }
  
  const employees = db.prepare('SELECT id, nom, prenom, poste, categorie FROM employees').all();
  
  for (const emp of employees) {
    db.prepare(`
      INSERT OR REPLACE INTO salaries 
      (employee_id, mois, annee, salaire_base, primes, heures_supplementaires, conge_annuel, conge_maladie, absences_non_justifiees, retenue_absence, autres_retenues, cnaps, ostie, irsa, salaire_net, statut)
      VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'valide')
    `).run(emp.id, parseInt(mois), parseInt(annee), SALAIRE_BASE_CATEGORIE[emp.categorie] || SALAIRE_BASE_CATEGORIE['default']);
  }
  
  res.json({ ok: true, generated: employees.length });
});

app.patch('/api/salaries/:id', (req, res) => {
  const { primes, heures_supplementaires, autres_retenues, statut } = req.body;
  
  const salary = db.prepare('SELECT * FROM salaries WHERE id = ?').get(req.params.id);
  if (!salary) return res.status(404).json({ error: 'Salaire non trouvé' });
  
  const updates = [];
  const params = [];
  
  if (primes !== undefined) {
    updates.push('primes = ?');
    params.push(primes);
  }
  if (heures_supplementaires !== undefined) {
    updates.push('heures_supplementaires = ?');
    params.push(heures_supplementaires);
  }
  if (autres_retenues !== undefined) {
    updates.push('autres_retenues = ?');
    params.push(autres_retenues);
  }
  if (statut !== undefined) {
    updates.push('statut = ?');
    params.push(statut);
  }
  
  if (updates.length === 0) {
    return res.status(400).json({ error: 'Aucune mise à jour' });
  }
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id);
  
  db.prepare(`UPDATE salaries SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

// ---------- Email Helper ----------
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmail(to, subject, content) {
  console.log(`[EMAIL] To: ${to}`);
  console.log(`[EMAIL] Subject: ${subject}`);
  console.log(`[EMAIL] Content: ${content}`);
  console.log('='.repeat(50));
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0;">ARIS Concept Company</h1>
      </div>
      <div style="padding: 30px; background: #f9f9f9;">
        <h2 style="color: #333;">${subject}</h2>
        <div style="font-size: 16px; color: #555; line-height: 1.6;">
          ${content.replace(/\n/g, '<br>')}
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 12px; text-align: center;">
          © ${new Date().getFullYear()} ARIS Concept Company. Tous droits réservés.
        </p>
      </div>
    </div>
  `;
  
  await sendRealEmail(to, subject, html);
}

app.post('/api/employe/send-verification', async (req, res) => {
  let { badge_code, email } = req.body;
  
  if (!badge_code || !email) {
    return res.status(400).json({ error: 'Matricule et email requis' });
  }
  
  if (!email.toLowerCase().endsWith('@aris-cc.com')) {
    return res.status(400).json({ error: 'L\'email doit être de la forme @aris-cc.com' });
  }
  
  // Check if email is already used by another employee
  const emailExists = db.prepare('SELECT * FROM employee_users WHERE email = ?').get(email.toLowerCase());
  if (emailExists) {
    return res.status(400).json({ error: 'Cet email est déjà utilisé par un autre compte. Veuillez utiliser un autre email ou contacter le responsable.' });
  }
  
  // Prepend ARIS- if not already present
  const normalizedBadge = badge_code.toUpperCase().startsWith('ARIS-') ? badge_code : `ARIS-${badge_code}`;
  const badgeIdOnly = badge_code.replace(/^ARIS-/i, '');
  
  const employee = db.prepare('SELECT * FROM employees WHERE badge_id = ? OR id_affichage = ?').get(normalizedBadge, badgeIdOnly);
  if (!employee) {
    return res.status(401).json({ 
      error: 'Matricule introuvable. Contactez le responsable si vous pensez que cela est une erreur.' 
    });
  }
  
  // Check if badge is already registered
  const existingBadgeUser = db.prepare('SELECT * FROM employee_users eu JOIN employees e ON eu.employee_id = e.id WHERE e.badge_id = ? OR e.id_affichage = ?').get(normalizedBadge, badgeIdOnly);
  if (existingBadgeUser) {
    return res.status(400).json({ error: 'Ce matricule est déjà utilisé par un autre compte. Veuillez vous connecter ou contacter le responsable.' });
  }
  
  const existingUser = db.prepare('SELECT * FROM employee_users WHERE employee_id = ?').get(employee.id);
  if (existingUser) {
    return res.status(400).json({ error: 'Ce compte existe déjà. Veuillez vous connecter.' });
  }
  
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  
  db.prepare('DELETE FROM email_verification WHERE employee_id = ?').run(employee.id);
  db.prepare('INSERT INTO email_verification (employee_id, code, email, expires_at) VALUES (?, ?, ?, ?)').run(
    employee.id, code, email.toLowerCase(), expiresAt.toISOString()
  );
  
  await sendEmail(
    email,
    'Code de vérification ARIS',
    `Bonjour ${employee.prenom} ${employee.nom},\n\nVotre code de vérification est: ${code}\n\nCe code expire dans 15 minutes.\n\nARIS Concept Company`
  );
  
  res.json({ 
    ok: true, 
    message: 'Code envoyé à votre email',
    employeeId: employee.id
  });
});

app.post('/api/employe/verify-code', (req, res) => {
  try {
  const { employeeId, code, badge_code, password, confirm_password } = req.body;
  
  if (!employeeId || !code || !password || !confirm_password) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }
  
  if (password !== confirm_password) {
    return res.status(400).json({ error: 'Les mots de passe ne correspondent pas' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
  }
  
  const verification = db.prepare(`
    SELECT * FROM email_verification 
    WHERE employee_id = ? AND code = ? AND expires_at > datetime('now')
  `).get(employeeId, code);
  
  if (!verification) {
    return res.status(400).json({ error: 'Code invalide ou expiré' });
  }
  
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!employee) {
    return res.status(404).json({ error: 'Employé non trouvé' });
  }
  
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO employee_users (employee_id, email, password_hash, is_verified) VALUES (?, ?, ?, 1)').run(
    employee.id, verification.email, passwordHash
  );
  
  db.prepare('DELETE FROM email_verification WHERE employee_id = ?').run(employee.id);
  
  const token = Buffer.from(String(employee.id)).toString('base64');
  res.json({ 
    ok: true, 
    message: 'Compte créé avec succès',
    token,
    employee: {
      id: employee.id,
      badge_id: employee.badge_id,
      nom: employee.nom,
      prenom: employee.prenom,
      poste: employee.poste,
      equipe: employee.equipe,
      email: verification.email,
      telephone: employee.telephone,
      adresse: employee.adresse,
      date_embauche: employee.date_embauche,
      categorie: employee.categorie
    }
  });
  } catch (err) {
    console.error('verify-code error:', err);
    res.status(500).json({ error: 'Erreur serveur: ' + err.message });
  }
});

app.post('/api/employe/login', (req, res) => {
  let { badge_code, password } = req.body;
  
  if (!badge_code || !password) {
    return res.status(400).json({ error: 'Matricule et mot de passe requis' });
  }
  
  // Prepend ARIS- if not already present
  const normalizedBadge = badge_code.toUpperCase().startsWith('ARIS-') ? badge_code : `ARIS-${badge_code}`;
  const badgeIdOnly = badge_code.replace(/^ARIS-/i, '');
  
  const employee = db.prepare('SELECT * FROM employees WHERE badge_id = ? OR id_affichage = ?').get(normalizedBadge, badgeIdOnly);
  if (!employee) {
    return res.status(401).json({ error: 'Matricule invalide' });
  }
  
  const userAccount = db.prepare('SELECT * FROM employee_users WHERE employee_id = ? AND is_active = 1').get(employee.id);
  if (!userAccount) {
    return res.status(401).json({ error: 'Compte non trouvé. Veuillez créer un compte d\'abord.' });
  }
  
  if (!bcrypt.compareSync(password, userAccount.password_hash)) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  
  const token = Buffer.from(String(employee.id)).toString('base64');
  res.json({ 
    ok: true, 
    token,
    employee: {
      id: employee.id,
      badge_id: employee.badge_id,
      nom: employee.nom,
      prenom: employee.prenom,
      poste: employee.poste,
      equipe: employee.equipe,
      email: userAccount.email,
      telephone: employee.telephone,
      adresse: employee.adresse,
      date_embauche: employee.date_embauche,
      categorie: employee.categorie
    }
  });
});

app.get('/api/employe/check/:badge_code', (req, res) => {
  const badgeCode = req.params.badge_code;
  const normalizedBadge = badgeCode.toUpperCase().startsWith('ARIS-') ? badgeCode : `ARIS-${badgeCode}`;
  const badgeIdOnly = badgeCode.replace(/^ARIS-/i, '');
  const employee = db.prepare('SELECT * FROM employees WHERE badge_id = ? OR id_affichage = ?').get(normalizedBadge, badgeIdOnly);
  if (!employee) {
    return res.json({ exists: false });
  }
  const userAccount = db.prepare('SELECT * FROM employee_users WHERE employee_id = ?').get(employee.id);
  res.json({ 
    exists: true, 
    hasAccount: !!userAccount,
    employee: {
      id: employee.id,
      badge_id: employee.badge_id,
      nom: employee.nom,
      prenom: employee.prenom
    }
  });
});

app.get('/api/employe/profile/:token', (req, res) => {
  try {
    const employeeId = parseInt(Buffer.from(req.params.token, 'base64').toString());
    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employé non trouvé' });
    }
    res.json({
      id: employee.id,
      badge_id: employee.badge_id,
      nom: employee.nom,
      prenom: employee.prenom,
      poste: employee.poste,
      equipe: employee.equipe,
      email: employee.email,
      telephone: employee.telephone,
      adresse: employee.adresse,
      date_embauche: employee.date_embauche,
      date_naissance: employee.date_naissance,
      cin: employee.cin,
      num_cnaps: employee.num_cnaps,
      categorie: employee.categorie,
      photo: employee.photo ? employee.photo : null
    });
  } catch (e) {
    res.status(400).json({ error: 'Token invalide' });
  }
});

// Change password for employee
app.post('/api/employe/change-password', (req, res) => {
  try {
    const { token, currentPassword, newPassword } = req.body;
    
    if (!token || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
    }
    
    const employeeId = parseInt(Buffer.from(token, 'base64').toString());
    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employé non trouvé' });
    }
    
    const user = db.prepare('SELECT * FROM employee_users WHERE employee_id = ?').get(employeeId);
    if (!user) {
      return res.status(404).json({ error: 'Compte non trouvé' });
    }
    
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }
    
    const newHash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE employee_users SET password_hash = ? WHERE employee_id = ?').run(newHash, employeeId);
    
    res.json({ success: true, message: 'Mot de passe modifié avec succès' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/employe/:id/photo', uploadPhoto.single('photo'), (req, res) => {
  try {
    console.log('[PHOTO] Upload request received');
    console.log('[PHOTO] params.id:', req.params.id);
    console.log('[PHOTO] file:', req.file ? req.file.originalname : 'no file');
    
    const employeeId = parseInt(req.params.id);
    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
    if (!employee) {
      console.log('[PHOTO] Employee not found:', employeeId);
      return res.status(404).json({ error: 'Employé non trouvé' });
    }

    if (!req.file) {
      console.log('[PHOTO] No file in request');
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const filename = `emp_${employeeId}${ext}`;
    const destPath = path.join(PHOTOS_DIR, filename);

    const oldPhoto = employee.photo;
    if (oldPhoto) {
      const oldPath = path.join(PHOTOS_DIR, path.basename(oldPhoto));
      if (fs.existsSync(oldPath) && oldPath !== destPath) {
        try { fs.unlinkSync(oldPath); } catch (_) {}
      }
    }

    console.log('[PHOTO] Saving to:', destPath);
    console.log('[PHOTO] Photo path to save:', `/photos/${filename}`);
    
    db.prepare('UPDATE employees SET photo = ? WHERE id = ?').run(`/photos/${filename}`, employeeId);
    
    const updated = db.prepare('SELECT photo FROM employees WHERE id = ?').get(employeeId);
    console.log('[PHOTO] Updated photo in DB:', updated.photo);
    
    res.json({ 
      success: true, 
      photo: `/photos/${filename}`,
      message: 'Photo mise à jour avec succès' 
    });
  } catch (e) {
    console.error('Photo upload error:', e);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la photo' });
  }
});

app.get('/api/employe/:id/photo', (req, res) => {
  try {
    const employeeId = parseInt(req.params.id);
    const employee = db.prepare('SELECT photo FROM employees WHERE id = ?').get(employeeId);
    if (!employee || !employee.photo) {
      return res.status(404).json({ error: 'Photo non trouvée' });
    }
    const photoPath = path.join(__dirname, employee.photo);
    if (fs.existsSync(photoPath)) {
      res.sendFile(photoPath);
    } else {
      res.status(404).json({ error: 'Fichier photo non trouvé' });
    }
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/employe/presences/:token', (req, res) => {
  try {
    const employeeId = parseInt(Buffer.from(req.params.token, 'base64').toString());
    const { mois, annee } = req.query;
    
    let query = `
      SELECT * FROM presence 
      WHERE employee_id = ?
    `;
    const params = [employeeId];
    
    if (mois && annee) {
      query += ` AND strftime('%m', scanned_at) = ? AND strftime('%Y', scanned_at) = ?`;
      params.push(String(mois).padStart(2, '0'), String(annee));
    }
    
    query += ' ORDER BY scanned_at DESC LIMIT 100';
    
    const presences = db.prepare(query).all(...params);
    res.json(presences);
  } catch (e) {
    res.status(400).json({ error: 'Token invalide' });
  }
});

app.get('/api/employe/conges/:token', (req, res) => {
  try {
    const employeeId = parseInt(Buffer.from(req.params.token, 'base64').toString());
    const conges = db.prepare(`
      SELECT * FROM conges 
      WHERE employee_id = ?
      ORDER BY created_at DESC
    `).all(employeeId);
    res.json(conges);
  } catch (e) {
    res.status(400).json({ error: 'Token invalide' });
  }
});

app.post('/api/employe/conges/:token', (req, res) => {
  try {
    const employeeId = parseInt(Buffer.from(req.params.token, 'base64').toString());
    const { type_conge, date_debut, date_fin, motif } = req.body;
    
    if (!type_conge || !date_debut || !date_fin) {
      return res.status(400).json({ error: 'Champs requis manquants' });
    }
    
    const debut = new Date(date_debut);
    const fin = new Date(date_fin);
    if (fin < debut) {
      return res.status(400).json({ error: 'La date de fin doit être après la date de début' });
    }
    
    const jours_calcules = Math.ceil((fin - debut) / (1000 * 60 * 60 * 24)) + 1;
    
    const result = db.prepare(`
      INSERT INTO conges (employee_id, type_conge, date_debut, date_fin, jours_calcules, motif, statut)
      VALUES (?, ?, ?, ?, ?, ?, 'en_attente')
    `).run(employeeId, type_conge, date_debut, date_fin, jours_calcules, motif || null);
    
    const employe = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
    if (employe) {
      addNotification('conge_demande', { ...employe, type_conge, date_debut, date_fin });
    }
    
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Erreur lors de la demande' });
  }
});

app.get('/api/employe/salaires/:token', (req, res) => {
  try {
    const employeeId = parseInt(Buffer.from(req.params.token, 'base64').toString());
    const salaries = db.prepare(`
      SELECT * FROM salaries 
      WHERE employee_id = ?
      ORDER BY annee DESC, mois DESC
    `).all(employeeId);
    res.json(salaries);
  } catch (e) {
    res.status(400).json({ error: 'Token invalide' });
  }
});

app.get('/api/employe/stats/:token', (req, res) => {
  try {
    const employeeId = parseInt(Buffer.from(req.params.token, 'base64').toString());
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentYear = now.getFullYear();
    
    const totalPresences = db.prepare('SELECT COUNT(*) as c FROM presence WHERE employee_id = ?').get(employeeId).c;
    
    const thisMonth = db.prepare(`
      SELECT COUNT(*) as c FROM presence 
      WHERE employee_id = ? AND strftime('%Y-%m', scanned_at) = ?
    `).get(employeeId, today.substring(0, 7)).c;
    
    const lastPresence = db.prepare(`
      SELECT * FROM presence WHERE employee_id = ? ORDER BY scanned_at DESC LIMIT 1
    `).get(employeeId);
    
    const congesApprouvesAnnee = db.prepare(`
      SELECT COALESCE(SUM(jours_calcules), 0) as total FROM conges 
      WHERE employee_id = ? AND statut = 'approuve' 
      AND type_conge = 'Congé annuel'
      AND (date_debut LIKE ? OR date_fin LIKE ?)
    `).get(employeeId, `${currentYear}%`, `${currentYear}%`).total;
    
    const congeAnnuelDroit = 30;
    const congesRestants = Math.max(0, congeAnnuelDroit - congesApprouvesAnnee);
    
    res.json({
      totalPresences,
      thisMonth,
      lastPresence,
      congesApprouves: congesApprouvesAnnee,
      congesRestants,
      congeAnnuelDroit,
      statut: lastPresence?.type === 'entrer' ? 'present' : lastPresence?.type === 'sortie' ? 'sortie' : 'absent'
    });
  } catch (e) {
    res.status(400).json({ error: 'Token invalide' });
  }
});

// ---------- Employee Heartbeat API (PC Status) ----------
app.post('/api/employe/heartbeat/:token', (req, res) => {
  try {
    const employeeId = parseInt(Buffer.from(req.params.token, 'base64').toString());
    if (isNaN(employeeId)) {
      return res.status(400).json({ error: 'Token invalide' });
    }
    
    db.prepare('UPDATE employees SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(employeeId);
    res.json({ ok: true, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error('Heartbeat error:', e);
    res.status(500).json({ error: 'Erreur heartbeat' });
  }
});

// PC Status Reporter API (pour le script sur les PCs des employés)
app.post('/api/pc-status/heartbeat', (req, res) => {
  try {
    const { badge_code, device_id, hostname } = req.body;
    
    if (!badge_code) {
      return res.status(400).json({ error: 'Badge code requis' });
    }
    
    // Normaliser le code badge
    const normalizedBadge = badge_code.toUpperCase().startsWith('ARIS-') 
      ? badge_code.toUpperCase() 
      : `ARIS-${badge_code}`;
    
    const badgeIdOnly = badge_code.replace(/^ARIS-/i, '');
    
    // Trouver l'employé
    const employee = db.prepare('SELECT id FROM employees WHERE badge_id = ? OR id_affichage = ?')
      .get(normalizedBadge, badgeIdOnly);
    
    if (!employee) {
      return res.status(404).json({ error: 'Employé non trouvé' });
    }
    
    // Mettre à jour le last_seen
    db.prepare('UPDATE employees SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(employee.id);
    
    console.log(`[PC-STATUS] ${hostname || 'Unknown'} (${device_id || 'N/A'}) - Employee ID ${employee.id} - PC Online`);
    
    res.json({ 
      ok: true, 
      message: 'PC status updated',
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('PC Status error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET PC Status d'un employé
app.get('/api/pc-status/:badgeCode', (req, res) => {
  try {
    const { badgeCode } = req.params;
    const normalizedBadge = badgeCode.toUpperCase().startsWith('ARIS-') 
      ? badgeCode.toUpperCase() 
      : `ARIS-${badgeCode}`;
    const badgeIdOnly = badgeCode.replace(/^ARIS-/i, '');
    
    const employee = db.prepare('SELECT id, last_seen FROM employees WHERE badge_id = ? OR id_affichage = ?')
      .get(normalizedBadge, badgeIdOnly);
    
    if (!employee) {
      return res.status(404).json({ error: 'Employé non trouvé' });
    }
    
    const pcOnlineThreshold = 5 * 60 * 1000; // 5 minutes
    const now = new Date();
    const lastSeen = employee.last_seen ? new Date(employee.last_seen) : null;
    const isOnline = lastSeen && (now - lastSeen) < pcOnlineThreshold;
    
    res.json({
      badge_code: badgeCode,
      pc_online: isOnline,
      last_seen: employee.last_seen,
      timestamp: now.toISOString()
    });
  } catch (e) {
    console.error('PC Status error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---------- Projets API ----------
app.get('/api/projets', (req, res) => {
  try {
    const projets = db.prepare(`
      SELECT p.*, e.prenom || ' ' || e.nom as created_by_name, e.badge_id as created_by_badge
      FROM projets p 
      LEFT JOIN employees e ON p.created_by = e.id 
      ORDER BY p.created_at DESC
    `).all();
    res.json(projets);
  } catch (error) {
    console.error('Error fetching projets:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des projets' });
  }
});

app.post('/api/projets', (req, res) => {
  try {
    const { nom, description, client, date_debut, date_fin_prevue, statut, employes, created_by } = req.body;
    
    if (!nom) {
      return res.status(400).json({ error: 'Le nom du projet est requis' });
    }

    const result = db.prepare(`
      INSERT INTO projets (nom, description, client, date_debut, date_fin_prevue, statut, employes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(nom, description || '', client || '', date_debut || '', date_fin_prevue || '', statut || 'en_cours', employes || '', created_by || null);

    res.status(201).json({ 
      id: result.lastInsertRowid, 
      message: 'Projet créé avec succès',
      ok: true 
    });
  } catch (error) {
    console.error('Error creating projet:', error);
    res.status(500).json({ error: 'Erreur lors de la création du projet' });
  }
});

app.put('/api/projets/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { nom, description, client, date_debut, date_fin_prevue, statut, employes } = req.body;

    const existing = db.prepare('SELECT * FROM projets WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Projet non trouvé' });
    }

    db.prepare(`
      UPDATE projets 
      SET nom = ?, description = ?, client = ?, date_debut = ?, date_fin_prevue = ?, statut = ?, employes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nom || existing.nom,
      description !== undefined ? description : existing.description,
      client !== undefined ? client : existing.client,
      date_debut !== undefined ? date_debut : existing.date_debut,
      date_fin_prevue !== undefined ? date_fin_prevue : existing.date_fin_prevue,
      statut || existing.statut,
      employes !== undefined ? employes : existing.employes,
      id
    );

    res.json({ message: 'Projet mis à jour avec succès', ok: true });
  } catch (error) {
    console.error('Error updating projet:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du projet' });
  }
});

app.delete('/api/projets/:id', (req, res) => {
  try {
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM projets WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Projet non trouvé' });
    }

    db.prepare('DELETE FROM projets WHERE id = ?').run(id);
    res.json({ message: 'Projet supprimé avec succès', ok: true });
  } catch (error) {
    console.error('Error deleting projet:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du projet' });
  }
});

// ---------- Employee Projets API ----------
app.get('/api/employe/projets/:token', (req, res) => {
  try {
    const employeeId = parseInt(Buffer.from(req.params.token, 'base64').toString());
    const projets = db.prepare(`
      SELECT p.*, e.prenom || ' ' || e.nom as created_by_name
      FROM projets p 
      LEFT JOIN employees e ON p.created_by = e.id 
      WHERE p.created_by = ? OR p.employes LIKE ?
      ORDER BY p.created_at DESC
    `).all(employeeId, `%${employeeId}%`);
    res.json(projets);
  } catch (error) {
    console.error('Error fetching employe projets:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des projets' });
  }
});

app.post('/api/employe/projets/:token', (req, res) => {
  try {
    const employeeId = parseInt(Buffer.from(req.params.token, 'base64').toString());
    const { nom, description, client, date_debut, date_fin_prevue, statut, employes } = req.body;
    
    if (!nom) {
      return res.status(400).json({ error: 'Le nom du projet est requis' });
    }

    const employesList = employes ? `${employeeId},${employes}` : String(employeeId);

    const result = db.prepare(`
      INSERT INTO projets (nom, description, client, date_debut, date_fin_prevue, statut, employes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(nom, description || '', client || '', date_debut || '', date_fin_prevue || '', statut || 'en_attente', employesList, employeeId);

    const employe = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
    if (employe) {
      addNotification('projet_cree', { ...employe, nom });
    }

    res.status(201).json({ 
      id: result.lastInsertRowid, 
      message: 'Projet créé avec succès',
      ok: true 
    });
  } catch (error) {
    console.error('Error creating employe projet:', error);
    res.status(500).json({ error: 'Erreur lors de la création du projet' });
  }
});

app.put('/api/employe/projets/:token/:id', (req, res) => {
  try {
    const employeeId = parseInt(Buffer.from(req.params.token, 'base64').toString());
    const { id } = req.params;
    const { nom, description, client, date_debut, date_fin_prevue, statut, employes } = req.body;

    const existing = db.prepare('SELECT * FROM projets WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Projet non trouvé' });
    }

    if (existing.created_by !== employeeId) {
      return res.status(403).json({ error: 'Vous n\'avez pas le droit de modifier ce projet' });
    }

    db.prepare(`
      UPDATE projets 
      SET nom = ?, description = ?, client = ?, date_debut = ?, date_fin_prevue = ?, statut = ?, employes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nom || existing.nom,
      description !== undefined ? description : existing.description,
      client !== undefined ? client : existing.client,
      date_debut !== undefined ? date_debut : existing.date_debut,
      date_fin_prevue !== undefined ? date_fin_prevue : existing.date_fin_prevue,
      statut || existing.statut,
      employes !== undefined ? employes : existing.employes,
      id
    );

    const employe = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
    if (employe) {
      addNotification('projet_modifie', { ...employe, nom: nom || existing.nom });
    }

    res.json({ message: 'Projet mis à jour avec succès', ok: true });
  } catch (error) {
    console.error('Error updating employe projet:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du projet' });
  }
});

app.delete('/api/employe/projets/:token/:id', (req, res) => {
  try {
    const employeeId = parseInt(Buffer.from(req.params.token, 'base64').toString());
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM projets WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Projet non trouvé' });
    }

    if (existing.created_by !== employeeId) {
      return res.status(403).json({ error: 'Vous n\'avez pas le droit de supprimer ce projet' });
    }

    const employe = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
    if (employe) {
      addNotification('projet_supprime', { ...employe, nom: existing.nom });
    }

    db.prepare('DELETE FROM projets WHERE id = ?').run(id);
    res.json({ message: 'Projet supprimé avec succès', ok: true });
  } catch (error) {
    console.error('Error deleting employe projet:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du projet' });
  }
});

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>404 - PresenceAris</title>
    <style>body{font-family:system-ui,sans-serif;background:#0d0d0d;color:#e8e8e8;margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;} a{color:#4da6ff;} a:hover{text-decoration:underline;} .links{margin-top:1rem;}</style>
    </head><body>
      <h1>404 — Page non trouvée</h1>
      <p>L'URL demandée n'existe pas.</p>
      <div class="links"><a href="/login">Connexion</a> &middot; <a href="/">Tableau de bord</a> &middot; <a href="/badge-exemple">Exemple badge</a></div>
    </body></html>
  `);
});

// ---------- Démarrage ----------
initEmailTransporter();

const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

// HTTPS uniquement
https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log('PresenceAris démarré sur https://localhost:' + PORT);
  console.log('Sur le réseau: https://192.168.4.250:' + PORT);
});

// HTTP pour le développement local (proxy Vite)
const http = require('http');
http.createServer(app).listen(3001, () => {
  console.log('PresenceAris HTTP sur http://localhost:3001');
});
