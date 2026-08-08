// backend/services/validation.js
//
// Uç noktalar arasında tekrar eden doğrulama mantığı için ortak yardımcılar.
// Amaç: geçersiz girdilerin PostgreSQL'e kadar sızıp 500 (ve olası hata
// detayı sızıntısı) üretmesini önlemek; bunun yerine erken, net bir 400
// döndürmek.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Express middleware üreticisi: verilen param adlarının geçerli UUID
 * olduğunu doğrular, değilse 400 döner.
 * Kullanım: router.get('/stores/:id', validateUuidParams('id'), handler)
 */
function validateUuidParams(...paramNames) {
  return (req, res, next) => {
    for (const name of paramNames) {
      const value = req.params[name];
      if (value !== undefined && !isUuid(value)) {
        return res.status(400).json({ error: `Geçersiz kimlik formatı: ${name}` });
      }
    }
    next();
  };
}

/**
 * Body/query üzerinde belirli alanların dolu olduğunu doğrular.
 * @returns {string|null} eksikse hata mesajı, tamamsa null
 */
function requireFields(obj, fields) {
  const missing = fields.filter((f) => obj[f] === undefined || obj[f] === null || obj[f] === '');
  if (missing.length) return `Eksik alan(lar): ${missing.join(', ')}`;
  return null;
}

/**
 * PostgreSQL hata kodlarını HTTP durum koduna çevirir. Route handler'larda
 * catch bloklarında kullanılabilir; tanınmayan hatalar next(err) ile genel
 * hata yakalayıcıya (500) düşmeye devam eder.
 *
 * 23505 = unique_violation → 409 Conflict
 * 23503 = foreign_key_violation → 400 Bad Request (referans edilen kayıt yok)
 * 22P02 = invalid_text_representation (örn. geçersiz UUID/enum) → 400
 */
function mapPgError(err) {
  if (err.code === '23505') return { status: 409, message: 'Bu kayıt zaten mevcut (benzersizlik ihlali).' };
  if (err.code === '23503') return { status: 400, message: 'İlişkili kayıt bulunamadı (geçersiz referans).' };
  if (err.code === '22P02') return { status: 400, message: 'Geçersiz veri formatı.' };
  return null;
}

/**
 * Route handler'ları sarmalayan yardımcı: yakalanan hatayı mapPgError ile
 * kontrol eder, eşleşirse doğrudan yanıtlar, eşleşmezse next(err)'e düşer.
 */
function handleDbError(err, res, next) {
  const mapped = mapPgError(err);
  if (mapped) return res.status(mapped.status).json({ error: mapped.message });
  next(err);
}

/**
 * Basit şifre gücü kontrolü (MVP seviyesi — Faz 5'te zorunlu karmaşıklık
 * kurallarına genişletilebilir). En az 8 karakter şart koşar.
 */
function isStrongEnoughPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8;
}

module.exports = { isUuid, validateUuidParams, requireFields, mapPgError, handleDbError, isStrongEnoughPassword };
