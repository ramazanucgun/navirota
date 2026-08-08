// backend/routes/store/mystore.js
//
// store_manager rolü, yalnızca token'daki storeId ile eşleşen mağazayı
// yönetebilir. requireOwnStore middleware'i bunu :storeId param'ı olan
// rotalarda garanti eder; burada storeId doğrudan req.user.storeId'den
// alındığı için ekstra kontrol gerekmez (kendi dışında bir ID'ye asla
// erişemez çünkü sorgular WHERE id = req.user.storeId ile sınırlıdır).

const express = require('express');
const { query } = require('../../db/pool');
const { recordAudit } = require('../../services/auditLog');

const router = express.Router();

function myStoreId(req) { return req.user.storeId; }

// GET /api/store/me — mağaza profili
router.get('/me', async (req, res, next) => {
  try {
    if (!myStoreId(req)) return res.status(403).json({ error: 'Kullanıcı bir mağazaya bağlı değil.' });
    const { rows } = await query(
      `SELECT s.*, f.label AS floor_label FROM stores s JOIN floors f ON f.id = s.floor_id WHERE s.id = $1`,
      [myStoreId(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Mağaza bulunamadı.' });
    res.json({ store: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/store/me — profil güncelle (logo, kapak, telefon, mesai, açıklama)
router.patch('/me', async (req, res, next) => {
  try {
    const { logoUrl, coverUrl, phone, website, description, openingHours } = req.body;
    const { rows } = await query(
      `UPDATE stores SET
         logo_url = COALESCE($1, logo_url), cover_url = COALESCE($2, cover_url),
         phone = COALESCE($3, phone), website = COALESCE($4, website),
         description = COALESCE($5, description),
         opening_hours = COALESCE($6, opening_hours)
       WHERE id = $7 RETURNING *`,
      [logoUrl, coverUrl, phone, website, description, openingHours ? JSON.stringify(openingHours) : null, myStoreId(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Mağaza bulunamadı.' });
    await recordAudit({ req, entity: 'store', entityId: myStoreId(req), action: 'update', diff: req.body });
    res.json({ store: rows[0] });
  } catch (err) { next(err); }
});

// --------------------------------------------------------------------
// KAMPANYA / KUPON — self-servis
// --------------------------------------------------------------------
router.get('/campaigns', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM campaigns WHERE store_id = $1 ORDER BY created_at DESC', [myStoreId(req)]);
    res.json({ campaigns: rows });
  } catch (err) { next(err); }
});

router.post('/campaigns', async (req, res, next) => {
  try {
    const {
      title, description, discountPercent, bannerUrl, videoUrl,
      ctaLabel, ctaUrl, couponCode, qrCoupon, badge, startsAt, endsAt,
    } = req.body;
    if (!title || !startsAt || !endsAt) return res.status(400).json({ error: 'title, startsAt, endsAt zorunludur.' });

    const { rows } = await query(
      `INSERT INTO campaigns (store_id, title, description, discount_percent, banner_url, video_url,
                               cta_label, cta_url, coupon_code, qr_coupon, badge, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,false),$11,$12,$13) RETURNING *`,
      [myStoreId(req), title, description, discountPercent, bannerUrl, videoUrl, ctaLabel, ctaUrl, couponCode, qrCoupon, badge, startsAt, endsAt]
    );
    await recordAudit({ req, entity: 'campaign', entityId: rows[0].id, action: 'create', diff: req.body });
    require('../../services/webhooks').dispatchWebhookEvent(req.mall.id, 'campaign.created', { campaignId: rows[0].id, title });
    res.status(201).json({ campaign: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/campaigns/:id', async (req, res, next) => {
  try {
    const { isActive, title, discountPercent, endsAt } = req.body;
    const { rows } = await query(
      `UPDATE campaigns SET
         is_active = COALESCE($1, is_active), title = COALESCE($2, title),
         discount_percent = COALESCE($3, discount_percent), ends_at = COALESCE($4, ends_at)
       WHERE id = $5 AND store_id = $6 RETURNING *`,
      [isActive, title, discountPercent, endsAt, req.params.id, myStoreId(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Kampanya bulunamadı.' });
    await recordAudit({ req, entity: 'campaign', entityId: req.params.id, action: 'update', diff: req.body });
    res.json({ campaign: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/campaigns/:id', async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM campaigns WHERE id = $1 AND store_id = $2', [req.params.id, myStoreId(req)]);
    if (!rowCount) return res.status(404).json({ error: 'Kampanya bulunamadı.' });
    await recordAudit({ req, entity: 'campaign', entityId: req.params.id, action: 'delete' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// --------------------------------------------------------------------
// ÜRÜNLER
// --------------------------------------------------------------------
router.get('/products', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM store_products WHERE store_id = $1 ORDER BY created_at DESC', [myStoreId(req)]);
    res.json({ products: rows });
  } catch (err) { next(err); }
});

router.post('/products', async (req, res, next) => {
  try {
    const { name, imageUrl, price } = req.body;
    if (!name) return res.status(400).json({ error: 'name zorunludur.' });
    const { rows } = await query(
      `INSERT INTO store_products (store_id, name, image_url, price) VALUES ($1,$2,$3,$4) RETURNING *`,
      [myStoreId(req), name, imageUrl, price]
    );
    res.status(201).json({ product: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/products/:id', async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM store_products WHERE id = $1 AND store_id = $2', [req.params.id, myStoreId(req)]);
    if (!rowCount) return res.status(404).json({ error: 'Ürün bulunamadı.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// --------------------------------------------------------------------
// İSTATİSTİKLER (yalnızca kendi mağazası)
// --------------------------------------------------------------------
router.get('/stats', async (req, res, next) => {
  try {
    const [searchHits, routesTo, campaignViews] = await Promise.all([
      query(`SELECT count(*) FROM search_logs WHERE matched_store_id = $1 AND searched_at > now() - interval '30 day'`, [myStoreId(req)]),
      query(`SELECT count(*) FROM route_logs WHERE to_store_id = $1 AND created_at > now() - interval '30 day'`, [myStoreId(req)]),
      query(`SELECT count(*) FROM campaigns WHERE store_id = $1 AND is_active`, [myStoreId(req)]),
    ]);
    res.json({
      last30Days: {
        searchAppearances: +searchHits.rows[0].count,
        routesToStore: +routesTo.rows[0].count,
      },
      activeCampaigns: +campaignViews.rows[0].count,
    });
  } catch (err) { next(err); }
});

module.exports = router;
