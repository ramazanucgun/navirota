// backend/routes/admin/stores.js
const express = require('express');
const { query } = require('../../db/pool');
const { recordAudit } = require('../../services/auditLog');
const { requireFields, handleDbError } = require('../../services/validation');

const router = express.Router();

// GET /api/admin/stores — yönetim listesi (pasifler dahil)
router.get('/stores', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.name, s.slug, s.unit_no, s.is_active, s.phone, f.label AS floor_label,
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
router.post('/stores', async (req, res, next) => {
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
    const { floorId, entranceNodeId, unitNo, isActive, phone, website } = req.body;
    const { rows } = await query(
      `UPDATE stores SET
         floor_id = COALESCE($1, floor_id),
         entrance_node_id = COALESCE($2, entrance_node_id),
         unit_no = COALESCE($3, unit_no),
         is_active = COALESCE($4, is_active),
         phone = COALESCE($5, phone),
         website = COALESCE($6, website)
       WHERE id = $7 AND mall_id = $8 RETURNING *`,
      [floorId, entranceNodeId, unitNo, isActive, phone, website, req.params.id, req.mall.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Mağaza bulunamadı.' });
    await recordAudit({ req, entity: 'store', entityId: req.params.id, action: 'update', diff: req.body });
    res.json({ store: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
