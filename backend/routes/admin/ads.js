// backend/routes/admin/ads.js
const express = require('express');
const { query } = require('../../db/pool');
const { recordAudit } = require('../../services/auditLog');

const router = express.Router();

// GET /api/admin/ads
router.get('/ads', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*, s.code AS slot_code, s.name AS slot_name,
              (SELECT array_agg(code) FROM categories WHERE id = ANY(a.target_categories)) AS target_category_codes,
              COALESCE(imp.count, 0) AS impressions, COALESCE(clk.count, 0) AS clicks
       FROM ads a
       JOIN ad_slots s ON s.id = a.slot_id
       LEFT JOIN (SELECT ad_id, count(*) FROM ad_events WHERE event_type='impression' GROUP BY ad_id) imp ON imp.ad_id = a.id
       LEFT JOIN (SELECT ad_id, count(*) FROM ad_events WHERE event_type='click' GROUP BY ad_id) clk ON clk.ad_id = a.id
       WHERE a.mall_id = $1 ORDER BY a.created_at DESC`,
      [req.mall.id]
    );
    const withCtr = rows.map((a) => ({ ...a, ctr: a.impressions > 0 ? +(a.clicks / a.impressions * 100).toFixed(2) : 0 }));
    res.json({ ads: withCtr });
  } catch (err) { next(err); }
});

// GET /api/admin/ad-slots — envanter tipleri (sabit liste)
router.get('/ad-slots', async (_req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM ad_slots ORDER BY name');
    res.json({ slots: rows });
  } catch (err) { next(err); }
});

// POST /api/admin/ads
router.post('/ads', async (req, res, next) => {
  try {
    const {
      slotCode, advertiserName, creativeType, creativeUrl, clickUrl,
      targetCategoryCodes = [], targetFloorId, priority, startsAt, endsAt,
    } = req.body;
    if (!slotCode || !creativeType || !creativeUrl || !startsAt || !endsAt) {
      return res.status(400).json({ error: 'slotCode, creativeType, creativeUrl, startsAt, endsAt zorunludur.' });
    }
    const slot = await query('SELECT id FROM ad_slots WHERE code = $1', [slotCode]);
    if (!slot.rows.length) return res.status(400).json({ error: 'Geçersiz slotCode.' });

    let categoryIds = [];
    if (targetCategoryCodes.length) {
      const cats = await query('SELECT id FROM categories WHERE code = ANY($1)', [targetCategoryCodes]);
      categoryIds = cats.rows.map((c) => c.id);
    }

    const { rows } = await query(
      `INSERT INTO ads (mall_id, slot_id, advertiser_name, creative_type, creative_url, click_url,
                         target_categories, target_floor_id, priority, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),$10,$11) RETURNING *`,
      [req.mall.id, slot.rows[0].id, advertiserName, creativeType, creativeUrl, clickUrl,
        categoryIds, targetFloorId || null, priority, startsAt, endsAt]
    );
    await recordAudit({ req, entity: 'ad', entityId: rows[0].id, action: 'create', diff: req.body });
    res.status(201).json({ ad: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/admin/ads/:id — tam düzenleme (yalnızca isActive/priority değil)
router.patch('/ads/:id', async (req, res, next) => {
  try {
    const {
      advertiserName, creativeType, creativeUrl, clickUrl,
      targetCategoryCodes, targetFloorId, isActive, priority, startsAt, endsAt,
    } = req.body;

    let categoryIds;
    if (Array.isArray(targetCategoryCodes)) {
      const cats = await query('SELECT id FROM categories WHERE code = ANY($1)', [targetCategoryCodes]);
      categoryIds = cats.rows.map((c) => c.id);
    }

    const { rows } = await query(
      `UPDATE ads SET
         advertiser_name = COALESCE($1, advertiser_name),
         creative_type = COALESCE($2, creative_type),
         creative_url = COALESCE($3, creative_url),
         click_url = COALESCE($4, click_url),
         target_categories = COALESCE($5, target_categories),
         target_floor_id = COALESCE($6, target_floor_id),
         is_active = COALESCE($7, is_active),
         priority = COALESCE($8, priority),
         starts_at = COALESCE($9, starts_at),
         ends_at = COALESCE($10, ends_at)
       WHERE id = $11 AND mall_id = $12 RETURNING *`,
      [advertiserName, creativeType, creativeUrl, clickUrl, categoryIds, targetFloorId,
        isActive, priority, startsAt, endsAt, req.params.id, req.mall.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Reklam bulunamadı.' });
    await recordAudit({ req, entity: 'ad', entityId: req.params.id, action: 'update', diff: req.body });
    res.json({ ad: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/admin/ads/:id
router.delete('/ads/:id', async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM ads WHERE id = $1 AND mall_id = $2', [req.params.id, req.mall.id]);
    if (!rowCount) return res.status(404).json({ error: 'Reklam bulunamadı.' });
    await recordAudit({ req, entity: 'ad', entityId: req.params.id, action: 'delete' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
