// backend/routes/public/v1.js
//
// Dış geliştiriciler / entegratörler için versiyonlanmış, API-anahtarı
// korumalı REST uçları (PRD Bölüm 3 — "API Gateway" modülü). JWT/oturum
// gerektirmez; X-API-Key başlığı ile kimlik doğrulanır (bkz. middleware/apiKeyAuth.js).

const express = require('express');
const { query } = require('../../db/pool');
const { requireScope } = require('../../middleware/apiKeyAuth');

const router = express.Router();

// GET /api/public/v1/stores
router.get('/v1/stores', requireScope('read'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.name, s.slug, s.phone, s.website, f.label AS floor_label, s.unit_no, s.is_active
       FROM stores s JOIN floors f ON f.id = s.floor_id
       WHERE s.mall_id = $1 ORDER BY s.name`,
      [req.mall.id]
    );
    res.json({ data: rows, mall: req.mall.slug });
  } catch (err) { next(err); }
});

// GET /api/public/v1/campaigns — aktif kampanyalar (ERP/CRM senkronu için)
router.get('/v1/campaigns', requireScope('read'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.title, c.discount_percent, c.coupon_code, c.starts_at, c.ends_at, s.name AS store_name, s.slug AS store_slug
       FROM campaigns c JOIN stores s ON s.id = c.store_id
       WHERE s.mall_id = $1 AND c.is_active = true AND now() BETWEEN c.starts_at AND c.ends_at
       ORDER BY c.created_at DESC`,
      [req.mall.id]
    );
    res.json({ data: rows, mall: req.mall.slug });
  } catch (err) { next(err); }
});

// GET /api/public/v1/analytics/summary — özet (BI/rapor entegrasyonları için)
router.get('/v1/analytics/summary', requireScope('read'), async (req, res, next) => {
  try {
    const [searches, routes] = await Promise.all([
      query(`SELECT count(*) FROM search_logs WHERE mall_id = $1 AND searched_at > now() - interval '30 day'`, [req.mall.id]),
      query(`SELECT count(*) FROM route_logs WHERE mall_id = $1 AND created_at > now() - interval '30 day'`, [req.mall.id]),
    ]);
    res.json({ data: { last30Days: { searches: +searches.rows[0].count, routesCalculated: +routes.rows[0].count } }, mall: req.mall.slug });
  } catch (err) { next(err); }
});

// POST /api/public/v1/campaigns — dış sistemden kampanya oluşturma (write scope gerektirir)
router.post('/v1/campaigns', requireScope('write'), async (req, res, next) => {
  try {
    const { storeSlug, title, discountPercent, startsAt, endsAt } = req.body;
    if (!storeSlug || !title || !startsAt || !endsAt) {
      return res.status(400).json({ error: 'storeSlug, title, startsAt, endsAt zorunludur.' });
    }
    const store = await query('SELECT id FROM stores WHERE mall_id = $1 AND slug = $2', [req.mall.id, storeSlug]);
    if (!store.rows.length) return res.status(404).json({ error: 'Mağaza bulunamadı.' });

    const { rows } = await query(
      `INSERT INTO campaigns (store_id, title, discount_percent, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [store.rows[0].id, title, discountPercent, startsAt, endsAt]
    );

    const { dispatchWebhookEvent } = require('../../services/webhooks');
    dispatchWebhookEvent(req.mall.id, 'campaign.created', { campaignId: rows[0].id, storeSlug, title });

    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
