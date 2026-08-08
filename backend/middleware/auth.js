// backend/middleware/auth.js
const { verifyAccessToken } = require('../services/auth');
const { query } = require('../db/pool');

/**
 * Authorization: Bearer <token> başlığını doğrular, req.user'ı doldurur.
 */
function requireAuth(req, res, next) {
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Oturum bulunamadı.' });
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, mallId: payload.mallId, storeId: payload.storeId };
    next();
  } catch {
    return res.status(401).json({ error: 'Oturum geçersiz veya süresi dolmuş.' });
  }
}

/**
 * Belirli rollere izin verir. Kullanım: requireRole('super_admin', 'mall_admin')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
    }
    next();
  };
}

/**
 * mall_admin ve store_manager'ı kendi mall_id'sine kilitler; super_admin
 * ise ?mall= parametresi ile herhangi bir AVM'yi hedefleyebilir.
 * Bu, tenant izolasyonunun uygulama katmanındaki zorunlu ikinci savunma
 * çizgisidir (schema.sql'deki mall_id FK'lerine ek olarak).
 */
async function scopeToMall(req, res, next) {
  try {
    if (req.user.role === 'super_admin') {
      const slug = req.query.mall || req.header('X-Mall-Slug');
      if (!slug) return res.status(400).json({ error: 'Super admin için ?mall= parametresi zorunludur.' });
      const { rows } = await query('SELECT id, slug, name FROM malls WHERE slug = $1', [slug]);
      if (!rows.length) return res.status(404).json({ error: 'AVM bulunamadı.' });
      req.mall = rows[0];
      return next();
    }
    if (!req.user.mallId) return res.status(403).json({ error: 'Kullanıcı bir AVM\'ye bağlı değil.' });
    const { rows } = await query('SELECT id, slug, name FROM malls WHERE id = $1', [req.user.mallId]);
    if (!rows.length) return res.status(404).json({ error: 'AVM bulunamadı.' });
    req.mall = rows[0];
    next();
  } catch (err) { next(err); }
}

/**
 * store_manager'ı yalnızca kendi mağazasına kilitler.
 */
function requireOwnStore(paramName = 'storeId') {
  return (req, res, next) => {
    if (req.user.role === 'store_manager') {
      const targetId = req.params[paramName] || req.body.storeId;
      if (targetId && targetId !== req.user.storeId) {
        return res.status(403).json({ error: 'Yalnızca kendi mağazanızı yönetebilirsiniz.' });
      }
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, scopeToMall, requireOwnStore };
