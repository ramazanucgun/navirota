// backend/routes/admin/campaigns.js
const express = require('express');
const { query } = require('../../db/pool');
const { recordAudit } = require('../../services/auditLog');

const router = express.Router();

// GET /api/admin/categories — kategoriler global taksonomi (mall'a özgü değil)
router.get('/categories', async (_req, res, next) => {
  try {
    const { rows } = await query('SELECT code, name_tr, name_en, icon FROM categories ORDER BY name_tr');
    res.json({ categories: rows });
  } catch (err) { next(err); }
});

// GET /api/admin/campaigns — AVM'deki tüm mağaza kampanyaları (moderasyon görünümü)
router.get('/campaigns', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, s.name AS store_name
       FROM campaigns c JOIN stores s ON s.id = c.store_id
       WHERE s.mall_id = $1 ORDER BY c.created_at DESC`,
      [req.mall.id]
    );
    res.json({ campaigns: rows });
  } catch (err) { next(err); }
});

// PATCH /api/admin/campaigns/:id/moderate  { isActive } — AVM yönetimi kampanyayı onaylar/durdurur
router.patch('/campaigns/:id/moderate', async (req, res, next) => {
  try {
    const { isActive } = req.body;
    const { rows } = await query(
      `UPDATE campaigns c SET is_active = $1
       FROM stores s WHERE c.store_id = s.id AND c.id = $2 AND s.mall_id = $3
       RETURNING c.*`,
      [isActive, req.params.id, req.mall.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Kampanya bulunamadı.' });
    await recordAudit({ req, entity: 'campaign', entityId: req.params.id, action: 'update', diff: { isActive } });
    res.json({ campaign: rows[0] });
  } catch (err) { next(err); }
});

// --------------------------------------------------------------------
// KATEGORİ KAMPANYALARI
// --------------------------------------------------------------------
router.get('/category-campaigns', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT cc.*, cat.name_tr AS category_name
       FROM category_campaigns cc JOIN categories cat ON cat.id = cc.category_id
       WHERE cc.mall_id = $1 ORDER BY cc.created_at DESC`,
      [req.mall.id]
    );
    res.json({ categoryCampaigns: rows });
  } catch (err) { next(err); }
});

router.post('/category-campaigns', async (req, res, next) => {
  try {
    const { categoryCode, title, description, discountPercent, bannerUrl, startsAt, endsAt } = req.body;
    if (!categoryCode || !title || !startsAt || !endsAt) {
      return res.status(400).json({ error: 'categoryCode, title, startsAt, endsAt zorunludur.' });
    }
    const { rows } = await query(
      `INSERT INTO category_campaigns (mall_id, category_id, title, description, discount_percent, banner_url, starts_at, ends_at)
       SELECT $1, id, $3, $4, $5, $6, $7, $8 FROM categories WHERE code = $2
       RETURNING *`,
      [req.mall.id, categoryCode, title, description, discountPercent, bannerUrl, startsAt, endsAt]
    );
    if (!rows.length) return res.status(400).json({ error: 'Geçersiz kategori kodu.' });
    await recordAudit({ req, entity: 'category_campaign', entityId: rows[0].id, action: 'create', diff: req.body });
    res.status(201).json({ categoryCampaign: rows[0] });
  } catch (err) { next(err); }
});

// --------------------------------------------------------------------
// AVM POPUP (tam ekran duyuru)
// --------------------------------------------------------------------
router.get('/popups', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM mall_popups WHERE mall_id = $1 ORDER BY created_at DESC', [req.mall.id]);
    res.json({ popups: rows });
  } catch (err) { next(err); }
});

router.post('/popups', async (req, res, next) => {
  try {
    const { title, mediaType, mediaUrl, ctaLabel, ctaUrl, showOncePerSession, startsAt, endsAt } = req.body;
    if (!mediaType || !mediaUrl || !startsAt || !endsAt) {
      return res.status(400).json({ error: 'mediaType, mediaUrl, startsAt, endsAt zorunludur.' });
    }
    const { rows } = await query(
      `INSERT INTO mall_popups (mall_id, title, media_type, media_url, cta_label, cta_url, show_once_per_session, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true),$8,$9) RETURNING *`,
      [req.mall.id, title, mediaType, mediaUrl, ctaLabel, ctaUrl, showOncePerSession, startsAt, endsAt]
    );
    await recordAudit({ req, entity: 'popup', entityId: rows[0].id, action: 'create', diff: req.body });
    res.status(201).json({ popup: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/popups/:id', async (req, res, next) => {
  try {
    const { isActive } = req.body;
    const { rows } = await query(
      `UPDATE mall_popups SET is_active = COALESCE($1, is_active) WHERE id = $2 AND mall_id = $3 RETURNING *`,
      [isActive, req.params.id, req.mall.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Popup bulunamadı.' });
    await recordAudit({ req, entity: 'popup', entityId: req.params.id, action: 'update', diff: req.body });
    res.json({ popup: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
