// backend/services/email.js
//
// Basit e-posta gönderim soyutlaması. SMTP_HOST tanımlıysa nodemailer ile
// gerçek e-posta gönderilir; tanımlı değilse (yerel geliştirme / henüz SMTP
// sağlayıcısı seçilmemiş ortamlar) mesaj konsola loglanır — böylece parola
// sıfırlama akışı SMTP olmadan da uçtan uca test edilebilir, ama production'da
// SMTP_HOST env değişkeni set edilmeden gerçek kullanıcıya e-posta gitmez.
//
// Production'a çıkmadan önce SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/
// SMTP_FROM ortam değişkenlerinin bir gerçek sağlayıcıya (SendGrid, Postmark,
// Amazon SES, vb. — SMTP arayüzü sunan herhangi biri) işaret etmesi gerekir.

const nodemailer = require('nodemailer');

let cachedTransport = null;

function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  if (cachedTransport) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return cachedTransport;
}

/**
 * @param {{ to: string, subject: string, html: string, text: string }} msg
 */
async function sendMail({ to, subject, html, text }) {
  const transport = getTransport();
  const from = process.env.SMTP_FROM || 'SmartWay AVM <no-reply@smartwayavm.com>';

  if (!transport) {
    // Dev-mode fallback: gerçek e-posta göndermek yerine loglar. Bu, SMTP
    // yapılandırılmamış ortamlarda (yerel geliştirme, bu inceleme ortamı gibi)
    // akışın kırılmadan test edilebilmesini sağlar.
    // eslint-disable-next-line no-console
    console.log(`[email:dev-mode] SMTP_HOST tanımlı değil, e-posta gönderilmedi.\n  Kime: ${to}\n  Konu: ${subject}\n  İçerik: ${text}`);
    return { delivered: false, devMode: true };
  }

  await transport.sendMail({ from, to, subject, html, text });
  return { delivered: true, devMode: false };
}

async function sendPasswordResetEmail(to, resetUrl) {
  return sendMail({
    to,
    subject: 'SmartWay AVM — Parola Sıfırlama',
    text: `Parolanızı sıfırlamak için şu bağlantıya tıklayın (1 saat geçerlidir): ${resetUrl}\n\nBu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.`,
    html: `<p>Parolanızı sıfırlamak için aşağıdaki bağlantıya tıklayın (1 saat geçerlidir):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>`,
  });
}

module.exports = { sendMail, sendPasswordResetEmail };
