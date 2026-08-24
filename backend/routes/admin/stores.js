// backend/routes/admin/stores.js
const express = require('express');
const { query } = require('../../db/pool');
const { recordAudit } = require('../../services/auditLog');
const { requireFields, handleDbError } = require('../../services/validation');
const { enforceLimit } = require('../../services/planLimits');

const router = express.Router();

// GET /api/admin/stores — yönetim listesi (pasifler dahil)
router.get('/stores', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.name, s.slug, s.description, s.logo_url, s.unit_no, s.is_active, s.phone, s.website,
              s.floor_id, s.entrance_node_id, s.polygon, f.label AS floor_label,
              array_agg(DISTINCT cat.code) FILTER (WHERE cat.id IS NOT NULL) AS category_codes,
              array_agg(DISTINCT cat.name_tr) FILTER (WHERE cat.id IS NOT NULL) AS categories
       FROM stores s
       JOIN floors f ON f.id = s.floor_id
       LEFT JOIN store_categories sc ON sc.store_id = s.id
       LEFT JOIN categories cat ON cat.id = sc.category_id
       WHERE s.mall_id = $1
       GROUP BY s.id, f.label
       ORDER BY s.name`,
      [req.mall.id]
    );
    res.json({ stores: rows });
  } catch (err) { next(err); }
});

// POST /api/admin/stores — yeni mağaza ekle (giriş kullanıcısı ile birlikte)
router.post('/stores', enforceLimit('stores'), async (req, res, next) => {
  try {
    const { name, slug, floorId, entranceNodeId, unitNo, categoryCodes = [], managerEmail, managerPassword } = req.body;
    if (!name || !slug || !floorId) return res.status(400).json({ error: 'name, slug ve floorId zorunludur.' });
    const storeRes = await query(
      `INSERT INTO stores (mall_id, floor_id, entrance_node_id, name, slug, unit_no)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.mall.id, floorId, entranceNodeId || null, name, slug, unitNo || null]
    );
    const store = storeRes.rows[0];

    for (const code of categoryCodes) {
      await query(
        `INSERT INTO store_categories (store_id, category_id)
         SELECT $1, id FROM categories WHERE code = $2 ON CONFLICT DO NOTHING`,
        [store.id, code]
      );
    }

    if (managerEmail && managerPassword) {
      const { hashPassword } = require('../../services/auth');
      const hash = await hashPassword(managerPassword);
      await query(
        `INSERT INTO users (mall_id, store_id, email, password_hash, full_name, role)
         VALUES ($1,$2,$3,$4,$5,'store_manager')
         ON CONFLICT (email) DO NOTHING`,
        [req.mall.id, store.id, managerEmail.toLowerCase().trim(), hash, name + ' Yöneticisi']
      );
    }

    await recordAudit({ req, entity: 'store', entityId: store.id, action: 'create', diff: { name, slug } });
    require('../../services/webhooks').dispatchWebhookEvent(req.mall.id, 'store.created', { storeId: store.id, name, slug });
    res.status(201).json({ store });
  } catch (err) { handleDbError(err, res, next); }
});

// PATCH /api/admin/stores/:id — taşı / güncelle / pasifleştir
router.patch('/stores/:id', async (req, res, next) => {
  try {
    const {
      name, description, logoUrl, floorId, entranceNodeId, unitNo,
      isActive, phone, website, categoryCodes, polygon,
    } = req.body;
    const { rows } = await query(
      `UPDATE stores SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         logo_url = COALESCE($3, logo_url),
         floor_id = COALESCE($4, floor_id),
         entrance_node_id = COALESCE($5, entrance_node_id),
         unit_no = COALESCE($6, unit_no),
         is_active = COALESCE($7, is_active),
         phone = COALESCE($8, phone),
         website = COALESCE($9, website),
         polygon = COALESCE($10, polygon)
       WHERE id = $11 AND mall_id = $12 RETURNING *`,
      [name, description, logoUrl, floorId, entranceNodeId, unitNo, isActive, phone, website,
        polygon ? JSON.stringify(polygon) : null, req.params.id, req.mall.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Mağaza bulunamadı.' });

    // Kategoriler gönderildiyse (undefined değilse) tamamen yeniden yazılır —
    // kısmi ekleme/çıkarma değil, "bu mağazanın kategorileri artık bunlar" mantığı.
    if (Array.isArray(categoryCodes)) {
      await query('DELETE FROM store_categories WHERE store_id = $1', [req.params.id]);
      for (const code of categoryCodes) {
        await query(
          `INSERT INTO store_categories (store_id, category_id)
           SELECT $1, id FROM categories WHERE code = $2 ON CONFLICT DO NOTHING`,
          [req.params.id, code]
        );
      }
    }

    await recordAudit({ req, entity: 'store', entityId: req.params.id, action: 'update', diff: req.body });
    res.json({ store: rows[0] });
  } catch (err) { handleDbError(err, res, next); }
});

module.exports = router;
