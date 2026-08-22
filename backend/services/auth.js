// backend/services/auth.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// GÜVENLİK: production'da JWT_SECRET tanımlı olmadan uygulamanın ayağa
// kalkmasına İZİN VERİLMEZ. Önceden bir fallback ('dev-secret-change-me')
// vardı — bu, env değişkeni unutulduğunda uygulamanın herkesçe bilinen zayıf
// bir secret ile SESSİZCE çalışmaya devam etmesi anlamına geliyordu (tüm JWT'ler
// tahmin edilebilir bir anahtarla imzalanır, bu da kimlik doğrulamayı komple
// atlatılabilir hale getirirdi). Geliştirme ortamında (NODE_ENV!=='production')
// kolaylık olsun diye fallback'e izin verilir, ancak production'da ASLA.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET ortam değişkeni production ortamında zorunludur. ' +
    'Uygulama, zayıf/bilinen bir varsayılan anahtarla production\'da çalışamaz.'
  );
}
const ACCESS_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 30;
const RESET_TOKEN_TTL_HOURS = 1;

async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}
async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      mallId: user.mall_id || null,
      storeId: user.store_id || null,
    },
    ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

function generateRefreshToken() {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { raw, hash, expiresAt };
}

function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Şifre sıfırlama token'ı üretir (refresh token ile aynı desen: yalnızca
 * hash veritabanında saklanır, ham değer tek seferlik e-postada gönderilir).
 */
function generatePasswordResetToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  return { raw, hash, expiresAt };
}

function hashPasswordResetToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  generatePasswordResetToken,
  hashPasswordResetToken,
  RESET_TOKEN_TTL_HOURS,
};
