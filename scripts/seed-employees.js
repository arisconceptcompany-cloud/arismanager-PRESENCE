/**
 * Enregistre les employés dans la base de données (liste ARIS)
 * Exécuter : node scripts/seed-employees.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '..', 'presence.db'));

const employees = [
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

employees.forEach((e) => {
  const badge_id = 'ARIS-' + String(e.id_affichage).padStart(4, '0');
  const existing = db.prepare('SELECT id FROM employees WHERE badge_id = ?').get(badge_id);
  if (existing) {
    db.prepare('UPDATE employees SET id_affichage=?, nom=?, prenom=?, poste=?, departement=?, email=?, adresse=?, telephone=?, equipe=?, date_naissance=?, date_embauche=?, categorie=?, cin=?, num_cnaps=?, mdp_mail=? WHERE badge_id=?').run(e.id_affichage, e.nom, e.prenom, e.poste || null, e.equipe || null, e.email || null, e.adresse || null, e.telephone || null, e.equipe || null, e.date_naissance || null, e.date_embauche || null, e.categorie || null, e.cin || null, e.num_cnaps || null, e.mdp_mail || null, badge_id);
    console.log('MAJ', badge_id, e.nom, e.prenom);
  } else {
    db.prepare('INSERT INTO employees (badge_id, id_affichage, nom, prenom, poste, departement, email, adresse, telephone, equipe, date_naissance, date_embauche, categorie, cin, num_cnaps, mdp_mail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(badge_id, e.id_affichage, e.nom, e.prenom, e.poste || null, e.equipe || null, e.email || null, e.adresse || null, e.telephone || null, e.equipe || null, e.date_naissance || null, e.date_embauche || null, e.categorie || null, e.cin || null, e.num_cnaps || null, e.mdp_mail || null);
    console.log('OK', badge_id, e.nom, e.prenom);
  }
});

console.log(employees.length + ' employés enregistrés dans la base.');
db.close();
