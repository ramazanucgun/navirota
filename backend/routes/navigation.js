// backend/routes/navigation.js
// QR okutma, mağaza arama ve rota hesaplama uç noktaları.

const express = require('express');
const { query } = require('../db/pool');
const { NavGraph } = require('../services/routeEngine');
const { resolveIntent } = require('../services/aiSearch');
const { isUuid, handleDbError } = require('../services/validation');

const router = express.Router();

// ---------------------------------------------------------------------
// POST /api/session — ziyaretçi oturumu başlatır (QR okutma sonrası).
// Dönen sessionId; arama/rota/reklam çağrılarında davranışsal hedefleme
// ve analitik için kullanılır.
// ---------------------------------------------------------------------
router.post('/session', async (req, res, next) => {
  try {
    const { entryQrCode, locale, deviceType } = req.body || {};
    const { rows } = await query(
      `INSERT INTO visitor_sessions (mall_id, entry_qr_code, locale, device_type)
       VALUES ($1,$2,COALESCE($3,'tr'),$4) RETURNING id`,
      [req.mall.id, entryQrCode || null, locale, deviceType || null]
    );
    res.status(201).json({ sessionId: rows[0].id });
  } catch (err) { next(err); }
});


// ---------------------------------------------------------------------
// GET /api/qr/:code  — QR okutulduğunda başlangıç noktasını döndürür
// ---------------------------------------------------------------------
router.get('/qr/:code', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT qr.code, n.id AS node_id, n.floor_id, n.x, n.y, f.level_index, f.label AS floor_label
       FROM qr_codes qr
       JOIN nav_nodes n ON n.id = qr.node_id
       JOIN floors f ON f.id = n.floor_id
       WHERE qr.mall_id = $1 AND qr.code = $2`,
      [req.mall.id, req.params.code]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'QR kodu tanınmadı.' });
    res.json({ startNode: rows[0] });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// GET /api/search?q=lc+waikiki — mağaza / kategori araması (öneri listesi)
// ---------------------------------------------------------------------
router.get('/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const sessionId = req.query.sessionId || null;
    if (q.length < 1) return res.json({ results: [] });

    const directRes = await query(
      `SELECT s.id, s.name, s.slug, s.logo_url, f.label AS floor_label, f.level_index,
              EXISTS (
                SELECT 1 FROM campaigns c
                WHERE c.store_id = s.id AND c.is_active = true
                  AND now() BETWEEN c.starts_at AND c.ends_at
              ) AS has_campaign
       FROM stores s
       JOIN floors f ON f.id = s.floor_id
       WHERE s.mall_id = $1 AND s.is_active = true
         AND s.name ILIKE '%' || $2 || '%'
       ORDER BY has_campaign DESC, s.name ASC
       LIMIT 15`,
      [req.mall.id, q]
    );
    let results = directRes.rows;
    let matchedCategoryCode = null;
    let aiNote = null;

    // Doğal dil / az sonuçlu sorgularda AI niyet çözümlemesiyle kategori
    // bazlı öneriye düş (PRD Bölüm 10 — "Doğal dil mağaza araması").
    const { categories, isNaturalLanguage } = resolveIntent(q);
    if (categories.length && (results.length === 0 || isNaturalLanguage)) {
      matchedCategoryCode = categories[0];
      const catRes = await query(
        `SELECT s.id, s.name, s.slug, s.logo_url, f.label AS floor_label, f.level_index,
                EXISTS (
                  SELECT 1 FROM campaigns c
                  WHERE c.store_id = s.id AND c.is_active = true
                    AND now() BETWEEN c.starts_at AND c.ends_at
                ) AS has_campaign
         FROM stores s
         JOIN floors f ON f.id = s.floor_id
         JOIN store_categories sc ON sc.store_id = s.id
         JOIN categories cat ON cat.id = sc.category_id
         WHERE s.mall_id = $1 AND s.is_active = true AND cat.code = ANY($2)
         ORDER BY has_campaign DESC, s.name ASC
         LIMIT 15`,
        [req.mall.id, categories]
      );
      const existingIds = new Set(results.map((r) => r.id));
      for (const r of catRes.rows) if (!existingIds.has(r.id)) results.push(r);
      if (catRes.rows.length) {
        const catLabel = await query('SELECT name_tr FROM categories WHERE code = $1', [matchedCategoryCode]);
        aiNote = catLabel.rows[0] ? `“${q}” için ${catLabel.rows[0].name_tr} kategorisini önerdik.` : null;
      }
    }

    // Analitik: arama logu + oturum bazlı kategori ilgi profili (davranışsal reklam hedeflemesi bunu okur)
    query(
      `INSERT INTO search_logs (mall_id, session_id, query_text, matched_store_id, matched_category_code)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.mall.id, sessionId, q, results[0]?.id || null, matchedCategoryCode]
    ).catch(() => {});

    res.json({ results, aiNote });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// GET /api/route?from=NODE_ID&to=STORE_ID&pref=shortest
// ---------------------------------------------------------------------
router.get('/route', async (req, res, next) => {
  try {
    const { from, to, pref = 'shortest' } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: '`from` (node id) ve `to` (store id) zorunludur.' });
    }
    if (!isUuid(from) || !isUuid(to)) {
      return res.status(400).json({ error: '`from` ve `to` geçerli bir kimlik (UUID) olmalıdır.' });
    }
    if (!['shortest', 'accessible', 'least_stairs'].includes(pref)) {
      return res.status(400).json({ error: 'Geçersiz `pref` değeri. shortest, accessible veya least_stairs olmalı.' });
    }

    const storeRes = await query(
      `SELECT entrance_node_id, name, floor_id FROM stores WHERE id = $1 AND mall_id = $2`,
      [to, req.mall.id]
    );
    if (storeRes.rows.length === 0) return res.status(404).json({ error: 'Mağaza bulunamadı.' });
    const targetNodeId = storeRes.rows[0].entrance_node_id;
    if (!targetNodeId) return res.status(422).json({ error: 'Mağazanın giriş noktası tanımlı değil.' });

    const [nodesRes, edgesRes] = await Promise.all([
      query(
        `SELECT n.id, n.floor_id AS "floorId", n.code, n.node_type AS type,
                n.x::float8 AS x, n.y::float8 AS y, n.accessible
         FROM nav_nodes n
         JOIN floors f ON f.id = n.floor_id
         WHERE f.mall_id = $1`,
        [req.mall.id]
      ),
      query(
        `SELECT e.from_node_id AS "fromId", e.to_node_id AS "toId",
                e.weight::float8 AS weight, e.edge_type AS "edgeType", e.bidirectional
         FROM nav_edges e
         JOIN nav_nodes n ON n.id = e.from_node_id
         JOIN floors f ON f.id = n.floor_id
         WHERE f.mall_id = $1`,
        [req.mall.id]
      ),
    ]);

    // Savunma katmanı: pg NUMERIC alanları string dönebilir; Number() ile garanti altına al.
    const nodes = nodesRes.rows.map((n) => ({ ...n, x: Number(n.x), y: Number(n.y) }));
    const edges = edgesRes.rows.map((e) => ({ ...e, weight: Number(e.weight) }));
    const graph = new NavGraph(nodes, edges);
    const result = graph.findPath(from, targetNodeId, pref);

    if (!result) {
      return res.status(404).json({ error: 'Bu iki nokta arasında rota bulunamadı.' });
    }

    const instructions = graph.toInstructions(result.path);

    query(
      `INSERT INTO route_logs (mall_id, from_node_id, to_store_id, distance, preference)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.mall.id, from, to, result.distance, pref]
    ).catch(() => {});
    require('../services/webhooks').dispatchWebhookEvent(req.mall.id, 'route.completed', {
      toStoreId: to, storeName: storeRes.rows[0].name, distance: result.distance,
    });

    res.json({
      storeName: storeRes.rows[0].name,
      distance: result.distance,
      path: result.path,
      floorChanges: result.floorChanges,
      instructions,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// GET /api/floors — ziyaretçi haritası için TAM kat/graf verisi (herkese
// açık, tenant-scoped). Admin panelinden girilen gerçek AVM verisiyle
// ziyaretçi haritasını dinamik olarak besler — sabit kodlu demo veri yerine.
// ---------------------------------------------------------------------
router.get('/floors', async (req, res, next) => {
  try {
    const floorsRes = await query(
      `SELECT id, level_index AS "levelIndex", label, viewbox, svg_content AS "svgContent"
       FROM floors WHERE mall_id = $1 ORDER BY level_index`,
      [req.mall.id]
    );

    const nodesRes = await query(
      `SELECT n.id, n.floor_id AS "floorId", n.code, n.node_type AS type,
              n.x::float8 AS x, n.y::float8 AS y, n.accessible
       FROM nav_nodes n JOIN floors f ON f.id = n.floor_id
       WHERE f.mall_id = $1`,
      [req.mall.id]
    );
    const edgesRes = await query(
      `SELECT e.from_node_id AS "fromId", e.to_node_id AS "toId",
              e.weight::float8 AS weight, e.edge_type AS "edgeType", e.bidirectional
       FROM nav_edges e
       JOIN nav_nodes n ON n.id = e.from_node_id
       JOIN floors f ON f.id = n.floor_id
       WHERE f.mall_id = $1`,
      [req.mall.id]
    );

    const nodesByFloor = {};
    for (const n of nodesRes.rows) {
      (nodesByFloor[n.floorId] ||= []).push(n);
    }

    const floors = floorsRes.rows.map((f) => ({
      id: f.id,
      levelIndex: f.levelIndex,
      label: f.label,
      viewbox: (f.viewbox || '0 0 1000 600').split(' ').map(Number),
      svgContent: f.svgContent || null,
      nodes: nodesByFloor[f.id] || [],
    }));

    res.json({ floors, edges: edgesRes.rows });
  } catch (err) { next(err); }
});

module.exports = router;
