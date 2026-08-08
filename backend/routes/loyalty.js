// backend/routes/loyalty.js
//
// Ziyaretçiler giriş yapmaz; istemcide üretilip localStorage'da saklanan
// bir UUID ("visitorId") ile anonim şekilde tanınırlar. Bu, kişisel veriyi
// asgari düzeyde tutarken (KVKK/GDPR ilkesi — PRD Bölüm 13) sadakat puanı,
// favoriler ve çekiliş katılımının cihaz bazında sürmesini sağlar.

const express = require('express');
const crypto = require('crypto');
const { query, pool } = require('../db/pool');
const { isUuid } = require('../services/validation');

const router = express.Router();

const EARN_RULES = new Map([
  ['qr_coupon', 20],
  ['route_complete', 5],
  ['raffle_share', 10],
]);

async function ensureVisitor(mallId, visitorId) {
  await query(
    `INSERT INTO visitors (id, mall_id) VALUES ($1,$2)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = now()`,
    [visitorId, mallId]
  );
}

// POST /api/visitor/init  { visitorId }
router.post('/visitor/init', async (req, res, next) => {
  try {
    const { visitorId } = req.body || {};
    if (!visitorId) return res.status(400).json({ error: 'visitorId zorunludur.' });
    if (!isUuid(visitorId)) return res.status(400).json({ error: 'visitorId geçerli bir UUID olmalıdır.' });
    await ensureVisitor(req.mall.id, visitorId);

    const [balanceRes, favRes] = await Promise.all([
      query('SELECT balance FROM loyalty_points WHERE visitor_id = $1', [visitorId]),
      query('SELECT store_id FROM favorites WHERE visitor_id = $1', [visitorId]),
    ]);
    res.json({
      balance: balanceRes.rows[0]?.balance || 0,
      favoriteStoreIds: favRes.rows.map((r) => r.store_id),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// SADAKAT / PUAN
// ---------------------------------------------------------------------

// GET /api/loyalty/:visitorId — bakiye + son işlemler
router.get('/loyalty/:visitorId', async (req, res, next) => {
  try {
    if (!isUuid(req.params.visitorId)) return res.status(400).json({ error: 'Geçersiz visitorId formatı.' });
    const [balanceRes, txRes] = await Promise.all([
      query('SELECT balance FROM loyalty_points WHERE visitor_id = $1', [req.params.visitorId]),
      query(
        `SELECT delta, reason, created_at FROM loyalty_transactions
         WHERE visitor_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [req.params.visitorId]
      ),
    ]);
    res.json({ balance: balanceRes.rows[0]?.balance || 0, transactions: txRes.rows });
  } catch (err) { next(err); }
});

// POST /api/loyalty/earn  { visitorId, reason, referenceId? }
router.post('/loyalty/earn', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { visitorId, reason, referenceId } = req.body || {};
    const points = EARN_RULES.get(reason);
    if (!visitorId || !points) return res.status(400).json({ error: 'Geçersiz visitorId veya reason.' });
    if (!isUuid(visitorId)) return res.status(400).json({ error: 'visitorId geçerli bir UUID olmalıdır.' });
    if (referenceId && !isUuid(referenceId)) return res.status(400).json({ error: 'referenceId geçerli bir UUID olmalıdır.' });

    await ensureVisitor(req.mall.id, visitorId);
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO loyalty_points (visitor_id, mall_id, balance) VALUES ($1,$2,$3)
       ON CONFLICT (visitor_id) DO UPDATE SET balance = loyalty_points.balance + $3, updated_at = now()`,
      [visitorId, req.mall.id, points]
    );
    await client.query(
      `INSERT INTO loyalty_transactions (visitor_id, mall_id, delta, reason, reference_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [visitorId, req.mall.id, points, reason, referenceId || null]
    );
    await client.query('COMMIT');

    const bal = await query('SELECT balance FROM loyalty_points WHERE visitor_id = $1', [visitorId]);
    res.json({ earned: points, balance: bal.rows[0].balance });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// ---------------------------------------------------------------------
// FAVORİLER
// ---------------------------------------------------------------------
router.post('/favorites/toggle', async (req, res, next) => {
  try {
    const { visitorId, storeId } = req.body || {};
    if (!visitorId || !storeId) return res.status(400).json({ error: 'visitorId ve storeId zorunludur.' });
    if (!isUuid(visitorId) || !isUuid(storeId)) return res.status(400).json({ error: 'visitorId ve storeId geçerli birer UUID olmalıdır.' });
    await ensureVisitor(req.mall.id, visitorId);

    // storeId'nin gerçekten bu AVM'ye ait olduğunu doğrula (çapraz-tenant favori eklemeyi önler)
    const storeCheck = await query('SELECT 1 FROM stores WHERE id = $1 AND mall_id = $2', [storeId, req.mall.id]);
    if (!storeCheck.rows.length) return res.status(404).json({ error: 'Mağaza bu AVM\'de bulunamadı.' });

    const existing = await query('SELECT 1 FROM favorites WHERE visitor_id = $1 AND store_id = $2', [visitorId, storeId]);
    if (existing.rows.length) {
      await query('DELETE FROM favorites WHERE visitor_id = $1 AND store_id = $2', [visitorId, storeId]);
      return res.json({ favorited: false });
    }
    await query('INSERT INTO favorites (visitor_id, store_id) VALUES ($1,$2)', [visitorId, storeId]);
    res.json({ favorited: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// DİJİTAL ÇEKİLİŞ
// ---------------------------------------------------------------------
router.get('/raffles/active', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, title, description, prize_label, entry_cost_points, ends_at
       FROM raffles WHERE mall_id = $1 AND is_active = true AND now() BETWEEN starts_at AND ends_at
       ORDER BY created_at DESC`,
      [req.mall.id]
    );
    res.json({ raffles: rows });
  } catch (err) { next(err); }
});

router.post('/raffles/:id/enter', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { visitorId } = req.body || {};
    if (!visitorId) return res.status(400).json({ error: 'visitorId zorunludur.' });
    if (!isUuid(visitorId) || !isUuid(req.params.id)) return res.status(400).json({ error: 'Geçersiz kimlik formatı.' });
    await ensureVisitor(req.mall.id, visitorId);

    const raffleRes = await query('SELECT * FROM raffles WHERE id = $1 AND mall_id = $2 AND is_active = true', [req.params.id, req.mall.id]);
    const raffle = raffleRes.rows[0];
    if (!raffle) return res.status(404).json({ error: 'Çekiliş bulunamadı.' });

    const already = await query('SELECT 1 FROM raffle_entries WHERE raffle_id = $1 AND visitor_id = $2', [req.params.id, visitorId]);
    if (already.rows.length) return res.status(409).json({ error: 'Bu çekilişe zaten katıldınız.' });

    await client.query('BEGIN');
    if (raffle.entry_cost_points > 0) {
      const bal = await client.query('SELECT balance FROM loyalty_points WHERE visitor_id = $1 FOR UPDATE', [visitorId]);
      const currentBalance = bal.rows[0]?.balance || 0;
      if (currentBalance < raffle.entry_cost_points) {
        await client.query('ROLLBACK');
        return res.status(402).json({ error: 'Yetersiz puan.', required: raffle.entry_cost_points, balance: currentBalance });
      }
      await client.query(
        `UPDATE loyalty_points SET balance = balance - $1, updated_at = now() WHERE visitor_id = $2`,
        [raffle.entry_cost_points, visitorId]
      );
      await client.query(
        `INSERT INTO loyalty_transactions (visitor_id, mall_id, delta, reason, reference_id) VALUES ($1,$2,$3,'raffle_entry',$4)`,
        [visitorId, req.mall.id, -raffle.entry_cost_points, raffle.id]
      );
    }
    await client.query('INSERT INTO raffle_entries (raffle_id, visitor_id) VALUES ($1,$2)', [req.params.id, visitorId]);
    await client.query('COMMIT');
    res.status(201).json({ entered: true });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

module.exports = router;
