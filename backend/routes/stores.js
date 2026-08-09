// backend/routes/stores.js
const express = require('express');
const { query } = require('../db/pool');
const { isUuid } = require('../services/validation');

const router = express.Router();

// GET /api/stores — kategori filtresiyle liste (kat planı ikonları için)
router.get('/stores', async (req, res, next) => {
  try {
    const { category, floor } = req.query;
    const params = [req.mall.id];
    let sql = `
      SELECT s.id, s.name, s.slug, s.logo_url, s.floor_id, s.entrance_node_id, f.level_index,
             s.polygon, s.unit_no,
             (SELECT json_agg(json_build_object('badge', c.badge, 'title', c.title))
                FROM campaigns c
                WHERE c.store_id = s.id AND c.is_active = true
                  AND now() BETWEEN c.starts_at AND c.ends_at) AS active_campaigns
      FROM stores s
      JOIN floors f ON f.id = s.floor_id
      WHERE s.mall_id = $1 AND s.is_active = true`;

    if (floor) { params.push(floor); sql += ` AND f.level_index = $${params.length}`; }
    if (category) {
      params.push(category);
      sql += ` AND EXISTS (
        SELECT 1 FROM store_categories sc JOIN categories cat ON cat.id = sc.category_id
        WHERE sc.store_id = s.id AND cat.code = $${params.length})`;
    }
    sql += ' ORDER BY s.name';

    const { rows } = await query(sql, params);
    res.json({ stores: rows });
  } catch (err) { next(err); }
});

// GET /api/stores/:slug — mağaza detay sayfası (kampanyalar dahil)
router.get('/stores/:slug', async (req, res, next) => {
  try {
    const storeRes = await query(
      `SELECT s.*, f.label AS floor_label, f.level_index
       FROM stores s JOIN floors f ON f.id = s.floor_id
       WHERE s.mall_id = $1 AND s.slug = $2 AND s.is_active = true`,
      [req.mall.id, req.params.slug]
    );
    if (storeRes.rows.length === 0) return res.status(404).json({ error: 'Mağaza bulunamadı.' });
    const store = storeRes.rows[0];

    const [campaigns, products] = await Promise.all([
      query(
        `SELECT id, title, description, discount_percent, banner_url, video_url,
                cta_label, cta_url, coupon_code, qr_coupon, badge, ends_at
         FROM campaigns
         WHERE store_id = $1 AND is_active = true AND now() BETWEEN starts_at AND ends_at
         ORDER BY created_at DESC`,
        [store.id]
      ),
      query('SELECT id, name, image_url, price FROM store_products WHERE store_id = $1', [store.id]),
    ]);

    res.json({ store, campaigns: campaigns.rows, products: products.rows });
  } catch (err) { next(err); }
});

// GET /api/categories
router.get('/categories', async (_req, res, next) => {
  try {
    const { rows } = await query('SELECT code, name_tr, name_en, icon FROM categories ORDER BY name_tr');
    res.json({ categories: rows });
  } catch (err) { next(err); }
});

// GET /api/popups/active — AVM tam ekran duyurusu (varsa)
router.get('/popups/active', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, title, media_type, media_url, cta_label, cta_url, show_once_per_session
       FROM mall_popups
       WHERE mall_id = $1 AND is_active = true AND now() BETWEEN starts_at AND ends_at
       ORDER BY created_at DESC LIMIT 1`,
      [req.mall.id]
    );
    res.json({ popup: rows[0] || null });
  } catch (err) { next(err); }
});

// GET /api/ads?slot=home_top — akıllı reklam seçimi (kategori/kat/davranışsal hedeflemeli)
router.get('/ads', async (req, res, next) => {
  try {
    const { slot, category, floor, sessionId } = req.query;

    // Davranışsal sinyal: bu oturumda son aranan kategoriler (PRD Bölüm 10 —
    // "Reklam hedefleme" — Faz 1 kural tabanlı, burada oturum geçmişiyle güçlendirilmiş hali).
    let behavioralCategories = [];
    if (sessionId) {
      const recent = await query(
        `SELECT DISTINCT matched_category_code FROM search_logs
         WHERE session_id = $1 AND matched_category_code IS NOT NULL
         ORDER BY matched_category_code LIMIT 3`,
        [sessionId]
      );
      behavioralCategories = recent.rows.map((r) => r.matched_category_code);
    }
    const allTargetCategories = [...new Set([category, ...behavioralCategories].filter(Boolean))];

    const params = [req.mall.id, slot];
    let sql = `
      SELECT a.id, a.creative_type, a.creative_url, a.click_url,
             (a.target_categories <> '{}' AND EXISTS (
                SELECT 1 FROM categories cat WHERE cat.id = ANY(a.target_categories) AND cat.code = ANY($3)
              )) AS behavioral_match
      FROM ads a JOIN ad_slots s ON s.id = a.slot_id
      WHERE a.mall_id = $1 AND s.code = $2 AND a.is_active = true
        AND now() BETWEEN a.starts_at AND a.ends_at`;
    params.push(allTargetCategories.length ? allTargetCategories : ['__none__']);

    if (floor) { params.push(floor); sql += ` AND (a.target_floor_id IS NULL OR a.target_floor_id = $${params.length})`; }
    // Hedeflemesi olan reklamlar arasından: davranışsal/kategori eşleşenler önce, sonra öncelik puanı
    sql += ` ORDER BY behavioral_match DESC, (a.target_categories = '{}') DESC, a.priority DESC LIMIT 1`;

    const { rows } = await query(sql, params);
    if (rows[0]) {
      query(`INSERT INTO ad_events (ad_id, event_type, session_id) VALUES ($1, 'impression', $2)`, [rows[0].id, sessionId || null]).catch(() => {});
    }
    res.json({ ad: rows[0] || null });
  } catch (err) { next(err); }
});

// POST /api/ads/:id/click — reklam tıklama takibi
router.post('/ads/:id/click', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Geçersiz reklam kimliği.' });
    // Reklamın gerçekten bu AVM'ye ait olduğunu doğrula (çapraz-tenant tıklama enjeksiyonunu önler)
    const adCheck = await query('SELECT 1 FROM ads WHERE id = $1 AND mall_id = $2', [req.params.id, req.mall.id]);
    if (!adCheck.rows.length) return res.status(404).json({ error: 'Reklam bulunamadı.' });
    await query(`INSERT INTO ad_events (ad_id, event_type) VALUES ($1, 'click')`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
