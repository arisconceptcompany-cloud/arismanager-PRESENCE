/**
 * Envoi de codes OTP par WhatsApp via CallMeBot (gratuit)
 * L'utilisateur doit d'abord : envoyer "I allow callmebot to send me messages"
 * au +34 644 95 42 75 sur WhatsApp, puis récupérer sa clé API.
 */
const https = require('https');

const CALLMEBOT_API = 'https://api.callmebot.com/whatsapp.php';

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  return phone.replace(/\D/g, '');
}

async function sendWhatsAppMessage(phone, text, apikey) {
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone || !apikey) {
    throw new Error('Numéro et clé API requis');
  }
  const phoneParam = cleanPhone.startsWith('261') ? '+' + cleanPhone : (cleanPhone.startsWith('0') ? '+261' + cleanPhone.slice(1) : '+' + cleanPhone);
  const url = `${CALLMEBOT_API}?phone=${encodeURIComponent(phoneParam)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
        } else {
          reject(new Error(body || 'Erreur CallMeBot'));
        }
      });
    }).on('error', reject);
  });
}

async function sendWhatsAppOTP(phone, code, apikey) {
  const text = `PresenceAris - Votre code de connexion : *${code}*\nValide 5 minutes.`;
  return sendWhatsAppMessage(phone, text, apikey);
}

module.exports = { sendWhatsAppOTP, sendWhatsAppMessage, normalizePhone };
