// backend/middleware/tenant.js
//
// Her istekte hangi AVM'ye (tenant) ait olduğumuzu belirler.
// Öncelik sırası:
//   1) X-Mall-Slug header (mobil app / PWA için)
//   2) ?mall=slug query param (QR linklerinde kullanılır: /r/K0-A-05?mall=terrace)
//   3) subdomain (terrace.smartwayavm.com)
//
// Bulunan mall, req.mall olarak sonraki handler'lara aktarılır; böylece
// her sorgu WHERE mall_id = $1 ile izole edilir ve tenant'lar birbirinin
// verisine asla erişemez.

const { query } = require('../db/pool');

async function resolveTenant(req, res, next) {
  try {
    const slug =
      req.header('X-Mall-Slug') ||
      req.query.mall ||
      req.hostname.split('.')[0];

    if (!slug) {
      return res.status(400).json({ error: 'AVM belirlenemedi (mall slug eksik).' });
    }

    const { rows } = await query(
      'SELECT id, slug, name, status, theme, default_locale, supported_locales FROM malls WHERE slug = $1',
      [slug]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: `'${slug}' adlı AVM bulunamadı.` });
    }

    const mall = rows[0];
    if (mall.status === 'suspended' || mall.status === 'cancelled') {
      return res.status(403).json({ error: 'Bu AVM hesabı şu anda aktif değil.' });
    }

    req.mall = mall;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { resolveTenant };
