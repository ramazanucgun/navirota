// backend/routes/admin/analytics.js
const express = require('express');
const { query, readQuery } = require('../../db/pool');

const router = express.Router();

// GET /api/admin/analytics/overview — üst özet kartları
// Not: analitik sorguları ağır/gecikmeye toleranslı olduğundan readQuery
// kullanır — PG_READ_REPLICA_HOST tanımlıysa otomatik olarak replikaya
// yönlenir (bkz. db/pool.js); tanımsızsa birincil havuza düşer, davranış
// değişmez.
router.get('/analytics/overview', async (req, res, next) => {
  try {
    const [searches, routes, adImpr, adClicks, activeStores] = await Promise.all([
      readQuery(`SELECT count(*) FROM search_logs WHERE mall_id = $1 AND searched_at > now() - interval '30 day'`, [req.mall.id]),
      readQuery(`SELECT count(*) FROM route_logs WHERE mall_id = $1 AND created_at > now() - interval '30 day'`, [req.mall.id]),
      readQuery(`SELECT count(*) FROM ad_events e JOIN ads a ON a.id = e.ad_id WHERE a.mall_id = $1 AND e.event_type='impression' AND e.occurred_at > now() - interval '30 day'`, [req.mall.id]),
      readQuery(`SELECT count(*) FROM ad_events e JOIN ads a ON a.id = e.ad_id WHERE a.mall_id = $1 AND e.event_type='click' AND e.occurred_at > now() - interval '30 day'`, [req.mall.id]),
      readQuery(`SELECT count(*) FROM stores WHERE mall_id = $1 AND is_active`, [req.mall.id]),
    ]);
    res.json({
      last30Days: {
        searches: +searches.rows[0].count,
        routesCalculated: +routes.rows[0].count,
        adImpressions: +adImpr.rows[0].count,
        adClicks: +adClicks.rows[0].count,
        ctr: +adImpr.rows[0].count > 0 ? +((+adClicks.rows[0].count / +adImpr.rows[0].count) * 100).toFixed(2) : 0,
      },
      activeStores: +activeStores.rows[0].count,
    });
  } catch (err) { next(err); }
});

// GET /api/admin/analytics/top-stores — en çok aranan / rota alınan mağazalar
router.get('/analytics/top-stores', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.name, s.slug, count(rl.id) AS route_count
       FROM route_logs rl JOIN stores s ON s.id = rl.to_store_id
       WHERE rl.mall_id = $1 AND rl.created_at > now() - interval '30 day'
       GROUP BY s.id ORDER BY route_count DESC LIMIT 10`,
      [req.mall.id]
    );
    res.json({ topStores: rows });
  } catch (err) { next(err); }
});

// GET /api/admin/analytics/hourly — saatlik yoğunluk (rota isteği bazlı)
router.get('/analytics/hourly', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT EXTRACT(HOUR FROM created_at)::int AS hour, count(*) AS count
       FROM route_logs WHERE mall_id = $1 AND created_at > now() - interval '7 day'
       GROUP BY hour ORDER BY hour`,
      [req.mall.id]
    );
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    rows.forEach((r) => { byHour[r.hour].count = +r.count; });
    res.json({ hourly: byHour });
  } catch (err) { next(err); }
});

// GET /api/admin/analytics/heatmap — kat bazlı yoğunluk (rota loglarındaki hedef mağazanın katı)
router.get('/analytics/heatmap', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT f.level_index, f.label, count(rl.id) AS visits
       FROM route_logs rl
       JOIN stores s ON s.id = rl.to_store_id
       JOIN floors f ON f.id = s.floor_id
       WHERE rl.mall_id = $1 AND rl.created_at > now() - interval '30 day'
       GROUP BY f.id ORDER BY f.level_index`,
      [req.mall.id]
    );
    res.json({ floorHeatmap: rows });
  } catch (err) { next(err); }
});

// GET /api/admin/analytics/searches — en çok aranan terimler (sonuçsuz aramalar dahil, ürün geliştirme sinyali)
router.get('/analytics/searches', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT query_text, count(*) AS count, count(matched_store_id) AS matched_count
       FROM search_logs WHERE mall_id = $1 AND searched_at > now() - interval '30 day'
       GROUP BY query_text ORDER BY count DESC LIMIT 20`,
      [req.mall.id]
    );
    res.json({ searches: rows });
  } catch (err) { next(err); }
});

module.exports = router;
