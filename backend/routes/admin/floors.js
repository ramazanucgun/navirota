// backend/routes/admin/floors.js
const express = require('express');
const { query } = require('../../db/pool');
const { recordAudit } = require('../../services/auditLog');

const router = express.Router();

// GET /api/admin/floors — mall_admin'in AVM'sindeki tüm katlar (node/edge sayılarıyla)
router.get('/floors', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT f.id, f.level_index, f.label, f.svg_url, f.viewbox,
              (SELECT count(*) FROM nav_nodes n WHERE n.floor_id = f.id) AS node_count,
              (SELECT count(*) FROM stores s WHERE s.floor_id = f.id AND s.is_active) AS store_count
       FROM floors f WHERE f.mall_id = $1 ORDER BY f.level_index`,
      [req.mall.id]
    );
    res.json({ floors: rows });
  } catch (err) { next(err); }
});

// POST /api/admin/floors  { levelIndex, label, viewbox }
router.post('/floors', async (req, res, next) => {
  try {
    const { levelIndex, label, viewbox } = req.body;
    if (levelIndex === undefined || !label) return res.status(400).json({ error: 'levelIndex ve label zorunludur.' });
    const { rows } = await query(
      `INSERT INTO floors (mall_id, level_index, label, viewbox)
       VALUES ($1,$2,$3,COALESCE($4,'0 0 1000 600'))
       ON CONFLICT (mall_id, level_index) DO UPDATE SET label = EXCLUDED.label
       RETURNING *`,
      [req.mall.id, levelIndex, label, viewbox]
    );
    await recordAudit({ req, entity: 'floor', entityId: rows[0].id, action: 'create', diff: req.body });
    res.status(201).json({ floor: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/admin/floors/:id/svg  { svgUrl } — kat planı yükleme sonrası URL güncelleme
router.patch('/floors/:id/svg', async (req, res, next) => {
  try {
    const { svgUrl } = req.body;
    const { rows } = await query(
      `UPDATE floors SET svg_url = $1 WHERE id = $2 AND mall_id = $3 RETURNING *`,
      [svgUrl, req.params.id, req.mall.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Kat bulunamadı.' });

    // Versiyon geçmişine kaydet (Bölüm 5.2 — floor_versions)
    const nodesSnap = await query('SELECT * FROM nav_nodes WHERE floor_id = $1', [req.params.id]);
    const edgesSnap = await query(
      `SELECT e.* FROM nav_edges e JOIN nav_nodes n ON n.id = e.from_node_id WHERE n.floor_id = $1`,
      [req.params.id]
    );
    await query(
      `INSERT INTO floor_versions (floor_id, svg_url, nodes_snapshot, edges_snapshot, published_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, svgUrl, JSON.stringify(nodesSnap.rows), JSON.stringify(edgesSnap.rows), req.user.id]
    );

    await recordAudit({ req, entity: 'floor', entityId: req.params.id, action: 'update', diff: { svgUrl } });
    res.json({ floor: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/admin/floors/:id/svg-content — SVG dosyasının HAM İÇERİĞİNİ kaydeder
// (Render gibi ücretsiz PaaS'lerde disk kalıcı olmadığından, dosya yolu değil
// doğrudan metin içeriği veritabanında saklanır.)
router.patch('/floors/:id/svg-content', async (req, res, next) => {
  try {
    const { svgContent } = req.body;
    if (!svgContent || typeof svgContent !== 'string') return res.status(400).json({ error: 'svgContent zorunludur.' });
    if (!svgContent.trim().startsWith('<svg') && !svgContent.includes('<svg')) {
      return res.status(400).json({ error: 'Geçerli bir SVG içeriği değil (dosya <svg> ile başlamalı).' });
    }
    if (svgContent.length > 2_000_000) return res.status(400).json({ error: 'SVG dosyası çok büyük (maks. ~2MB).' });

    const { rows } = await query(
      `UPDATE floors SET svg_content = $1 WHERE id = $2 AND mall_id = $3 RETURNING id, level_index, label`,
      [svgContent, req.params.id, req.mall.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Kat bulunamadı.' });
    await recordAudit({ req, entity: 'floor', entityId: req.params.id, action: 'update', diff: { svgContentUpdated: true } });
    res.json({ floor: rows[0] });
  } catch (err) { next(err); }
});

// GET /api/admin/floors/:id/graph — düzenleyicinin mevcut node/edge verisini
// yüklemesi için (PUT .../graph ile simetrik, code-tabanlı format döner)
router.get('/floors/:id/graph', async (req, res, next) => {
  try {
    const floorCheck = await query(
      'SELECT id, label, viewbox, svg_content AS "svgContent" FROM floors WHERE id = $1 AND mall_id = $2',
      [req.params.id, req.mall.id]
    );
    if (!floorCheck.rows.length) return res.status(404).json({ error: 'Kat bulunamadı.' });

    const nodesRes = await query(
      `SELECT id, code, node_type AS type, x::float8 AS x, y::float8 AS y, linked_group AS "linkedGroup", accessible
       FROM nav_nodes WHERE floor_id = $1 ORDER BY code`,
      [req.params.id]
    );
    const idToCode = Object.fromEntries(nodesRes.rows.map((n) => [n.id, n.code]));
    const edgesRes = await query(
      `SELECT e.from_node_id, e.to_node_id, e.weight::float8 AS weight, e.edge_type AS "edgeType", e.bidirectional
       FROM nav_edges e JOIN nav_nodes n ON n.id = e.from_node_id
       WHERE n.floor_id = $1`,
      [req.params.id]
    );
    const edges = edgesRes.rows.map((e) => ({
      fromCode: idToCode[e.from_node_id], toCode: idToCode[e.to_node_id],
      weight: e.weight, edgeType: e.edgeType, bidirectional: e.bidirectional,
    })).filter((e) => e.fromCode && e.toCode);

    res.json({
      floor: floorCheck.rows[0],
      nodes: nodesRes.rows.map(({ id, ...rest }) => rest),
      edges,
    });
  } catch (err) { next(err); }
});

// DELETE /api/admin/floors/:id
router.delete('/floors/:id', async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM floors WHERE id = $1 AND mall_id = $2', [req.params.id, req.mall.id]);
    if (!rowCount) return res.status(404).json({ error: 'Kat bulunamadı.' });
    await recordAudit({ req, entity: 'floor', entityId: req.params.id, action: 'delete' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// --------------------------------------------------------------------
// NAV NODE / EDGE (koridor grafiği) — SVG düzenleyicinin kaydettiği veri
// --------------------------------------------------------------------

// PUT /api/admin/floors/:id/graph  { nodes:[{code,type,x,y,accessible}], edges:[{fromCode,toCode,weight,edgeType}] }
// Tüm graf tek seferde (editörden) yeniden yazılır — no-code CMS akışı.
router.put('/floors/:id/graph', async (req, res, next) => {
  const client = await require('../../db/pool').pool.connect();
  try {
    const { nodes = [], edges = [] } = req.body;
    const floorCheck = await query('SELECT id FROM floors WHERE id = $1 AND mall_id = $2', [req.params.id, req.mall.id]);
    if (!floorCheck.rows.length) return res.status(404).json({ error: 'Kat bulunamadı.' });

    await client.query('BEGIN');
    await client.query('DELETE FROM nav_nodes WHERE floor_id = $1', [req.params.id]);

    const codeToId = {};
    for (const n of nodes) {
      const r = await client.query(
        `INSERT INTO nav_nodes (floor_id, code, node_type, x, y, linked_group, accessible)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [req.params.id, n.code, n.type || 'corridor', n.x, n.y, n.linkedGroup || null, n.accessible !== false]
      );
      codeToId[n.code] = r.rows[0].id;
    }
    for (const e of edges) {
      if (!codeToId[e.fromCode] || !codeToId[e.toCode]) continue;
      await client.query(
        `INSERT INTO nav_edges (from_node_id, to_node_id, weight, edge_type, bidirectional)
         VALUES ($1,$2,$3,$4,$5)`,
        [codeToId[e.fromCode], codeToId[e.toCode], e.weight || 1, e.edgeType || 'walk', e.bidirectional !== false]
      );
    }
    await client.query('COMMIT');
    await recordAudit({ req, entity: 'floor_graph', entityId: req.params.id, action: 'update', diff: { nodeCount: nodes.length, edgeCount: edges.length } });
    res.json({ ok: true, nodeCount: nodes.length, edgeCount: edges.length });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// --------------------------------------------------------------------
// QR YÖNETİMİ
// --------------------------------------------------------------------

// GET /api/admin/qr — AVM'deki tüm QR'lar (yazdırma/checklist için)
router.get('/qr', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT qr.id, qr.code, qr.label, qr.printed_at, n.node_type, f.label AS floor_label
       FROM qr_codes qr JOIN nav_nodes n ON n.id = qr.node_id JOIN floors f ON f.id = n.floor_id
       WHERE qr.mall_id = $1 ORDER BY f.level_index, qr.code`,
      [req.mall.id]
    );
    res.json({ qrCodes: rows });
  } catch (err) { next(err); }
});

// POST /api/admin/qr/generate-all — kattaki tüm node'lar için eksik QR'ları toplu üretir
router.post('/qr/generate-all', async (req, res, next) => {
  try {
    const { floorId } = req.body;
    const nodes = await query(
      `SELECT n.id, n.code, n.node_type FROM nav_nodes n
       JOIN floors f ON f.id = n.floor_id
       WHERE f.mall_id = $1 ${floorId ? 'AND f.id = $2' : ''}`,
      floorId ? [req.mall.id, floorId] : [req.mall.id]
    );

    let created = 0;
    for (const n of nodes.rows) {
      const r = await query(
        `INSERT INTO qr_codes (mall_id, node_id, code, label)
         VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING RETURNING id`,
        [req.mall.id, n.id, n.code, `${n.node_type} — ${n.code}`]
      );
      if (r.rows.length) created++;
    }
    await recordAudit({ req, entity: 'qr_codes', action: 'create', diff: { created, floorId } });
    res.json({ created, total: nodes.rows.length });
  } catch (err) { next(err); }
});

// PATCH /api/admin/qr/:id/printed — fiziksel olarak basıldı işaretle
router.patch('/qr/:id/printed', async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE qr_codes SET printed_at = now() WHERE id = $1 AND mall_id = $2 RETURNING *`,
      [req.params.id, req.mall.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'QR bulunamadı.' });
    res.json({ qrCode: rows[0] });
  } catch (err) { next(err); }
});

// GET /api/admin/floors/:id/entrance-nodes — mağaza oluşturma formunda
// "Giriş Noktası" seçimi için, bu kattaki store_entrance tipi node'ları döner.
router.get('/floors/:id/entrance-nodes', async (req, res, next) => {
  try {
    const floorCheck = await query('SELECT id FROM floors WHERE id = $1 AND mall_id = $2', [req.params.id, req.mall.id]);
    if (!floorCheck.rows.length) return res.status(404).json({ error: 'Kat bulunamadı.' });
    const { rows } = await query(
      `SELECT id, code FROM nav_nodes WHERE floor_id = $1 AND node_type = 'store_entrance' ORDER BY code`,
      [req.params.id]
    );
    res.json({ entranceNodes: rows });
  } catch (err) { next(err); }
});

module.exports = router;
