// backend/routes/admin/signage.js
const express = require('express');
const crypto = require('crypto');
const { query } = require('../../db/pool');
const { recordAudit } = require('../../services/auditLog');

const router = express.Router();

function generatePairingCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

// --------------------------------------------------------------------
// CİHAZLAR
// --------------------------------------------------------------------
router.get('/signage/devices', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT d.*, f.label AS floor_label, p.name AS playlist_name
       FROM signage_devices d
       LEFT JOIN floors f ON f.id = d.floor_id
       LEFT JOIN signage_playlists p ON p.id = d.playlist_id
       WHERE d.mall_id = $1 ORDER BY d.created_at DESC`,
      [req.mall.id]
    );
    res.json({ devices: rows });
  } catch (err) { next(err); }
});

// POST /api/admin/signage/devices — yeni ekran kaydı (eşleştirme kodu üretir)
router.post('/signage/devices', async (req, res, next) => {
  try {
    const { name, floorId, locationLabel, orientation, resolutionW, resolutionH, isKioskMode } = req.body;
    if (!name) return res.status(400).json({ error: 'name zorunludur.' });

    let pairingCode;
    for (let i = 0; i < 5; i++) {
      pairingCode = generatePairingCode();
      const exists = await query('SELECT 1 FROM signage_devices WHERE pairing_code = $1', [pairingCode]);
      if (!exists.rows.length) break;
    }

    const { rows } = await query(
      `INSERT INTO signage_devices (mall_id, name, floor_id, location_label, orientation, resolution_w, resolution_h, is_kiosk_mode, pairing_code)
       VALUES ($1,$2,$3,$4,COALESCE($5,'landscape'),COALESCE($6,1920),COALESCE($7,1080),COALESCE($8,true),$9)
       RETURNING *`,
      [req.mall.id, name, floorId || null, locationLabel, orientation, resolutionW, resolutionH, isKioskMode, pairingCode]
    );
    await recordAudit({ req, entity: 'signage_device', entityId: rows[0].id, action: 'create', diff: { name } });
    res.status(201).json({ device: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/admin/signage/devices/:id — playlist ata / pasifleştir
router.patch('/signage/devices/:id', async (req, res, next) => {
  try {
    const { playlistId, isActive, name, locationLabel } = req.body;
    const { rows } = await query(
      `UPDATE signage_devices SET
         playlist_id = COALESCE($1, playlist_id), is_active = COALESCE($2, is_active),
         name = COALESCE($3, name), location_label = COALESCE($4, location_label)
       WHERE id = $5 AND mall_id = $6 RETURNING *`,
      [playlistId, isActive, name, locationLabel, req.params.id, req.mall.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cihaz bulunamadı.' });
    await recordAudit({ req, entity: 'signage_device', entityId: req.params.id, action: 'update', diff: req.body });
    res.json({ device: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/signage/devices/:id', async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM signage_devices WHERE id = $1 AND mall_id = $2', [req.params.id, req.mall.id]);
    if (!rowCount) return res.status(404).json({ error: 'Cihaz bulunamadı.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// --------------------------------------------------------------------
// PLAYLIST'LER
// --------------------------------------------------------------------
router.get('/signage/playlists', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*, (SELECT count(*) FROM signage_playlist_items i WHERE i.playlist_id = p.id) AS item_count
       FROM signage_playlists p WHERE p.mall_id = $1 ORDER BY p.created_at DESC`,
      [req.mall.id]
    );
    res.json({ playlists: rows });
  } catch (err) { next(err); }
});

router.post('/signage/playlists', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name zorunludur.' });
    const { rows } = await query(
      `INSERT INTO signage_playlists (mall_id, name) VALUES ($1,$2) RETURNING *`,
      [req.mall.id, name]
    );
    await recordAudit({ req, entity: 'signage_playlist', entityId: rows[0].id, action: 'create', diff: { name } });
    res.status(201).json({ playlist: rows[0] });
  } catch (err) { next(err); }
});

// GET /api/admin/signage/playlists/:id/items
router.get('/signage/playlists/:id/items', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM signage_playlist_items WHERE playlist_id = $1 ORDER BY sort_order`,
      [req.params.id]
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
});

// POST /api/admin/signage/playlists/:id/items — içerik ekle (reklam/kampanya/popup/özel medya)
router.post('/signage/playlists/:id/items', async (req, res, next) => {
  try {
    const { contentType, referenceId, mediaUrl, durationSeconds, dayOfWeek, startHour, endHour, sortOrder } = req.body;
    if (!contentType) return res.status(400).json({ error: 'contentType zorunludur.' });
    if (!['ad', 'campaign', 'popup', 'custom_media'].includes(contentType)) {
      return res.status(400).json({ error: 'Geçersiz contentType.' });
    }
    const { rows } = await query(
      `INSERT INTO signage_playlist_items (playlist_id, sort_order, content_type, reference_id, media_url, duration_seconds, day_of_week, start_hour, end_hour)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,10),$7,$8,$9) RETURNING *`,
      [req.params.id, sortOrder || 0, contentType, referenceId || null, mediaUrl || null, durationSeconds, dayOfWeek || null, startHour, endHour]
    );
    res.status(201).json({ item: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/signage/playlists/:playlistId/items/:itemId', async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM signage_playlist_items WHERE id = $1 AND playlist_id = $2', [req.params.itemId, req.params.playlistId]);
    if (!rowCount) return res.status(404).json({ error: 'İçerik bulunamadı.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
