// backend/middleware/apiKeyAuth.js
//
// Üçüncü parti entegratörler için X-API-Key tabanlı kimlik doğrulama.
// JWT'den farklı olarak insan oturumu değil, sunucu-sunucu entegrasyonu
// (ERP/CRM/webhook alıcıları) hedefler. Anahtar yalnızca oluşturulduğu an
// tam olarak gösterilir; veritabanında yalnızca sha256 hash'i tutulur.

const crypto = require('crypto');
const { query } = require('../db/pool');

function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

async function requireApiKey(req, res, next) {
  const rawKey = req.header('X-API-Key');
  if (!rawKey) return res.status(401).json({ error: 'X-API-Key başlığı zorunludur.' });

  try {
    const hash = hashApiKey(rawKey);
    const { rows } = await query(
      `SELECT ak.id, ak.mall_id, ak.scopes, m.slug, m.name, m.status
       FROM api_keys ak JOIN malls m ON m.id = ak.mall_id
       WHERE ak.key_hash = $1 AND ak.revoked_at IS NULL`,
      [hash]
    );
    if (!rows.length) return res.status(401).json({ error: 'Geçersiz API anahtarı.' });
    const key = rows[0];
    if (key.status === 'suspended' || key.status === 'cancelled') {
      return res.status(403).json({ error: 'Bu AVM hesabı aktif değil.' });
    }

    req.mall = { id: key.mall_id, slug: key.slug, name: key.name };
    req.apiKey = { id: key.id, scopes: key.scopes };
    query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [key.id]).catch(() => {});
    next();
  } catch (err) { next(err); }
}

function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKey?.scopes?.includes(scope)) {
      return res.status(403).json({ error: `Bu işlem '${scope}' yetkisi gerektirir.` });
    }
    next();
  };
}

module.exports = { requireApiKey, requireScope, hashApiKey };
