// backend/routes/privacy.js
//
// KVKK (6698 Sayılı Kişisel Verilerin Korunması Kanunu) md. 11 — ilgili
// kişinin kendi verisine erişim ve silme talep etme hakkı.
//
// Ziyaretçiler giriş yapmadığından (bkz. routes/loyalty.js'teki açıklama),
// yetkilendirme modeli diğer ziyaretçi uçlarıyla (favorites/loyalty) aynıdır:
// istemci cihazında localStorage'da saklanan visitorId'yi BİLMEK, o veriye
// erişim yetkisidir — ayrıca bir şifre/login yoktur (zaten kişisel kimlik
// bilgisi toplanmadığından kurulacak bir "hesap" da yoktur). Bu uç noktalar,
// tenant (mall) izolasyonunu ihlal etmemek için `visitors.mall_id`'yi
// `req.mall.id` ile eşleştirir.

const express = require('express');
const { query, withTransaction } = require('../db/pool');
const { isUuid } = require('../services/validation');
const { recordAudit } = require('../services/auditLog');

const router = express.Router();

async function loadVisitorOrNull(mallId, visitorId) {
  const { rows } = await query(
    'SELECT id, first_seen_at, last_seen_at, locale FROM visitors WHERE id = $1 AND mall_id = $2',
    [visitorId, mallId]
  );
  return rows[0] || null;
}

// GET /api/privacy/:visitorId/export — "Verilerimi indir"
// Bu ziyaretçiyle ilişkilendirilmiş TÜM veriyi tek bir JSON olarak döner.
router.get('/privacy/:visitorId/export', async (req, res, next) => {
  try {
    const { visitorId } = req.params;
    if (!isUuid(visitorId)) return res.status(400).json({ error: 'Geçersiz visitorId formatı.' });

    const visitor = await loadVisitorOrNull(req.mall.id, visitorId);
    if (!visitor) return res.status(404).json({ error: 'Bu AVM için kayıtlı veri bulunamadı.' });

    const [loyalty, transactions, vouchers, favorites, raffleEntries, pushSubs] = await Promise.all([
      query('SELECT balance, updated_at FROM loyalty_points WHERE visitor_id = $1', [visitorId]),
      query('SELECT delta, reason, reference_id, created_at FROM loyalty_transactions WHERE visitor_id = $1 ORDER BY created_at DESC', [visitorId]),
      query('SELECT value_label, points_cost, redeem_code, redeemed_at, created_at FROM gift_vouchers WHERE visitor_id = $1 ORDER BY created_at DESC', [visitorId]),
      query(`SELECT f.store_id, s.name AS store_name, f.created_at FROM favorites f JOIN stores s ON s.id = f.store_id WHERE f.visitor_id = $1`, [visitorId]),
      query(`SELECT r.id AS raffle_id, r.title, re.created_at FROM raffle_entries re JOIN raffles r ON r.id = re.raffle_id WHERE re.visitor_id = $1 ORDER BY re.created_at DESC`, [visitorId]),
      query('SELECT endpoint, favorite_store_ids, created_at FROM push_subscriptions WHERE visitor_id = $1', [visitorId]),
    ]);

    await recordAudit({ req, entity: 'visitor', entityId: visitorId, action: 'data_export_requested' });

    res.json({
      exportedAt: new Date().toISOString(),
      visitor,
      loyalty: loyalty.rows[0] || { balance: 0 },
      loyaltyTransactions: transactions.rows,
      giftVouchers: vouchers.rows,
      favorites: favorites.rows,
      raffleEntries: raffleEntries.rows,
      pushSubscriptions: pushSubs.rows,
    });
  } catch (err) { next(err); }
});

// DELETE /api/privacy/:visitorId — "Verilerimi sil" (KVKK md. 7 — imha/silme)
// visitors satırı silinince loyalty_points/loyalty_transactions/gift_vouchers/
// raffle_entries/favorites/push_subscriptions ON DELETE CASCADE ile otomatik
// silinir (bkz. schema_v3.sql). Yalnızca raffles.winner_visitor_id CASCADE
// DEĞİL (bilinçli — bir çekilişin "kazananı X'ti" kaydı AVM tarafında iş
// kaydı olarak kalmalı), bu yüzden önce NULL'lanır.
router.delete('/privacy/:visitorId', async (req, res, next) => {
  try {
    const { visitorId } = req.params;
    if (!isUuid(visitorId)) return res.status(400).json({ error: 'Geçersiz visitorId formatı.' });

    const visitor = await loadVisitorOrNull(req.mall.id, visitorId);
    if (!visitor) return res.status(404).json({ error: 'Bu AVM için kayıtlı veri bulunamadı.' });

    await withTransaction(async (client) => {
      await client.query('UPDATE raffles SET winner_visitor_id = NULL WHERE winner_visitor_id = $1', [visitorId]);
      await client.query('DELETE FROM visitors WHERE id = $1 AND mall_id = $2', [visitorId, req.mall.id]);
    });

    await recordAudit({ req, entity: 'visitor', entityId: visitorId, action: 'data_deleted' });

    res.json({ ok: true, message: 'Verileriniz kalıcı olarak silindi.' });
  } catch (err) { next(err); }
});

module.exports = router;
