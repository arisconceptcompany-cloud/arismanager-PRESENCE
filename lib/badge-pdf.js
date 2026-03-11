/**
 * Badge PresenceAris — design type photo : zone sombre (photo, ID, nom, fonction) + zone rose (logo, adresse, QR unique)
 * Format : 86 x 54 mm
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const QRCode = require('qrcode');

const BADGE_WIDTH_MM = 86;
const BADGE_HEIGHT_MM = 54;
const MM_TO_PT = 72 / 25.4;
const BORDER_COLOR = { r: 0.3, g: 0.65, b: 1 };   // bleu clair
const TOP_BG = { r: 0.17, g: 0.17, b: 0.17 };     // gris foncé
const BOTTOM_BG = { r: 0.91, g: 0.29, b: 0.54 };  // rose/magenta
const WHITE = rgb(1, 1, 1);
const TEXT_MUTED = rgb(0.85, 0.85, 0.85);

function mmToPt(mm) {
  return mm * MM_TO_PT;
}

function formatIdAffichage(id) {
  if (id == null) return null;
  const n = parseInt(id, 10);
  if (isNaN(n)) return null;
  return 'ID:' + String(n).padStart(4, '0');
}

/**
 * Génère un PDF badge au design de la maquette (zone sombre + zone rose, QR unique par employé)
 */
async function generateBadgePdf(employee, logoPath, options = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = mmToPt(BADGE_WIDTH_MM);
  const pageHeight = mmToPt(BADGE_HEIGHT_MM);
  const page = doc.addPage([pageWidth, pageHeight]);

  const border = 2;
  const topZoneHeight = 30; // mm
  const bottomZoneHeight = 24; // mm - plus grand
  const topHeightPt = mmToPt(topZoneHeight);
  const bottomHeightPt = mmToPt(bottomZoneHeight);

  // Bordure bleu clair
  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
    borderColor: rgb(BORDER_COLOR.r, BORDER_COLOR.g, BORDER_COLOR.b),
    borderWidth: border,
  });

  // Zone du haut (gris foncé) - en bas du page car pdf-lib origin is bottom-left
  page.drawRectangle({
    x: border,
    y: bottomHeightPt + border + 1,
    width: pageWidth - 2 * border,
    height: topHeightPt - border - 1,
    color: rgb(TOP_BG.r, TOP_BG.g, TOP_BG.b),
  });

  // Ligne de séparation blanche
  page.drawRectangle({
    x: border,
    y: bottomHeightPt + border,
    width: pageWidth - 2 * border,
    height: 1,
    color: WHITE,
  });

  // Zone du bas (rose)
  page.drawRectangle({
    x: border,
    y: border,
    width: pageWidth - 2 * border,
    height: bottomHeightPt - border,
    color: rgb(BOTTOM_BG.r, BOTTOM_BG.g, BOTTOM_BG.b),
  });

  const margin = mmToPt(3);
  
  // --- Zone haute : photo, ID, NOM, PRENOM, fonction ---
  const photoSize = mmToPt(22);
  const photoX = border + margin;
  const photoY = bottomHeightPt + border + mmToPt(3);

  // Cadre photo
  page.drawRectangle({
    x: photoX,
    y: photoY,
    width: photoSize,
    height: photoSize,
    borderColor: rgb(BORDER_COLOR.r, BORDER_COLOR.g, BORDER_COLOR.b),
    borderWidth: 1.5,
    color: rgb(0.25, 0.25, 0.25),
  });
  
  // Initiales
  const initiales = ((employee.prenom || '')[0] || '') + ((employee.nom || '')[0] || '');
  if (initiales) {
    page.drawText(initiales.toUpperCase(), {
      x: photoX + photoSize / 2 - 4,
      y: photoY + photoSize / 2 - 4,
      size: 10,
      font: fontBold,
      color: WHITE,
    });
  }

  const textX = photoX + photoSize + mmToPt(4);
  let textY = photoY + photoSize - mmToPt(3);

  // ID
  const idLabel = formatIdAffichage(employee.id_affichage != null ? employee.id_affichage : employee.id) || employee.badge_id;
  page.drawText(idLabel, {
    x: textX,
    y: textY,
    size: 11,
    font: fontBold,
    color: WHITE,
  });
  textY -= mmToPt(4);

  // NOM
  const nom = (employee.nom || '').toUpperCase();
  page.drawText(nom, {
    x: textX,
    y: textY,
    size: 8,
    font: fontBold,
    color: WHITE,
  });
  textY -= mmToPt(3.5);

  // PRÉNOM
  const prenom = (employee.prenom || '');
  page.drawText(prenom, {
    x: textX,
    y: textY,
    size: 7,
    font: font,
    color: TEXT_MUTED,
  });
  textY -= mmToPt(3);

  // Fonction
  const fonction = (employee.poste || employee.fonction || '').toUpperCase();
  if (fonction) {
    page.drawText(fonction, {
      x: textX,
      y: textY,
      size: 6,
      font: font,
      color: rgb(0.6, 0.6, 0.6),
    });
  }

  // --- Zone basse : logo, adresse avec icône, QR ---
  const bottomY = border + mmToPt(2);
  
  // Logo - à gauche
  const logoFile = path.join(path.dirname(__dirname), logoPath || 'logo.png');
  let logoWidth = 0;
  if (fs.existsSync(logoFile)) {
    try {
      const logoBytes = fs.readFileSync(logoFile);
      const logoImage = await doc.embedPng(logoBytes);
      const logoH = mmToPt(14);
      logoWidth = (logoImage.width / logoImage.height) * logoH;
      page.drawImage(logoImage, {
        x: border + mmToPt(3),
        y: bottomY + mmToPt(3),
        width: logoWidth,
        height: logoH,
      });
    } catch (e) {
      console.log('Logo error:', e.message);
    }
  }
  
  // Adresse au centre avec icône localisation
  const adresse = options.adresseSociete || employee.adresse || 'Lot II T 104 A lavoloha, Antananarivo 102';
  const adresseLines = adresse.split(',').map(s => s.trim());
  
  // Icône localisation (petit cercle)
  const iconX = border + mmToPt(20);
  page.drawCircle({
    x: iconX + mmToPt(2),
    y: bottomY + mmToPt(9),
    size: mmToPt(2),
    color: rgb(0.3, 0.65, 1),
  });
  page.drawCircle({
    x: iconX + mmToPt(2),
    y: bottomY + mmToPt(9),
    size: mmToPt(1),
    color: rgb(0.91, 0.29, 0.54),
  });
  
  let addrX = iconX + mmToPt(6);
  let addrY = bottomY + mmToPt(11);
  adresseLines.forEach((line, i) => {
    if (i < 3) {
      page.drawText(line, {
        x: addrX,
        y: addrY - i * mmToPt(4),
        size: 5.5,
        font: font,
        color: WHITE,
      });
    }
  });
  
  // QR Code - à droite, plus grand
  const qrSize = mmToPt(24);
  const qrX = pageWidth - border - mmToPt(3) - qrSize;
  const qrContent = employee.id_affichage != null ? String(employee.id_affichage) : employee.badge_id;
  const qrBuffer = await QRCode.toBuffer(qrContent, { width: 200, margin: 1 });
  const qrImage = await doc.embedPng(qrBuffer);
  page.drawImage(qrImage, {
    x: qrX,
    y: bottomY + mmToPt(2),
    width: qrSize,
    height: qrSize,
  });

  return doc.save();
}

async function generateBadgePdfFromTemplate(employee, templatePath, logoPath) {
  const templateFull = path.isAbsolute(templatePath) ? templatePath : path.join(path.dirname(__dirname), templatePath);
  if (!fs.existsSync(templateFull)) {
    return generateBadgePdf(employee, logoPath);
  }
  const existingPdfBytes = fs.readFileSync(templateFull);
  const doc = await PDFDocument.load(existingPdfBytes);
  const pages = doc.getPages();
  const page = pages[0];
  if (!page) return generateBadgePdf(employee, logoPath);
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 12;
  let y = pageHeight - margin;
  const idLabel = formatIdAffichage(employee.id_affichage != null ? employee.id_affichage : employee.id) || employee.badge_id;
  page.drawText(idLabel, { x: margin + 40, y, size: 12, font: fontBold, color: rgb(1, 1, 1) });
  y -= 14;
  page.drawText((employee.nom || '').toUpperCase(), { x: margin + 40, y, size: 9, font: fontBold, color: rgb(1, 1, 1) });
  y -= 10;
  page.drawText(employee.prenom || '', { x: margin + 40, y, size: 9, font: font, color: rgb(0.9, 0.9, 0.9) });
  const fonction = (employee.poste || '').toUpperCase();
  if (fonction) page.drawText(fonction, { x: pageWidth - margin - 60, y: pageHeight - 50, size: 8, font: font, color: rgb(0.5, 0.5, 0.5) });
  const qrContent = employee.id_affichage != null ? String(employee.id_affichage) : employee.badge_id;
  const qrBuffer = await QRCode.toBuffer(qrContent, { width: 180, margin: 1 });
  const qrImage = await doc.embedPng(qrBuffer);
  const qrSize = 34;
  page.drawImage(qrImage, { x: pageWidth - margin - qrSize, y: margin + 4, width: qrSize, height: qrSize });
  return doc.save();
}

module.exports = { generateBadgePdf, generateBadgePdfFromTemplate, formatIdAffichage };
