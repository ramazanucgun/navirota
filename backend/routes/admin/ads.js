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

// PATCH /api/admin/ads/:id  { isActive, priority }
router.patch('/ads/:id', async (req, res, next) => {
  try {
    const { isActive, priority } = req.body;
    const { rows } = await query(
      `UPDATE ads SET is_active = COALESCE($1, is_active), priority = COALESCE($2, priority)
       WHERE id = $3 AND mall_id = $4 RETURNING *`,
      [isActive, priority, req.params.id, req.mall.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Reklam bulunamadı.' });
    await recordAudit({ req, entity: 'ad', entityId: req.params.id, action: 'update', diff: req.body });
    res.json({ ad: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
