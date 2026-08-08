// backend/routes/signage.js
//
// Kiosk cihazları AVM'ye özel giriş yapmaz; kurulumda üretilen tek seferlik
// `pairing_code` ile eşleştirilir. Bu uç, cihazın kendi mall'ünü ve aktif
// playlist içeriğini (gerçek medya URL'leriyle çözümlenmiş) döndürür.

const express = require('express');
const { query } = require('../db/pool');

const router = express.Router();

// GET /api/signage/:pairingCode/playlist
router.get('/signage/:pairingCode/playlist', async (req, res, next) => {
  try {
    const deviceRes = await query(
      `SELECT d.id, d.mall_id, d.name, d.orientation, d.is_kiosk_mode, d.playlist_id, m.name AS mall_name
       FROM signage_devices d JOIN malls m ON m.id = d.mall_id
       WHERE d.pairing_code = $1 AND d.is_active = true`,
      [req.params.pairingCode]
    );
    if (!deviceRes.rows.length) return res.status(404).json({ error: 'Cihaz bulunamadı veya pasif.' });
    const device = deviceRes.rows[0];

    await query('UPDATE signage_devices SET last_seen_at = now() WHERE id = $1', [device.id]);

    if (!device.playlist_id) return res.json({ device, items: [] });

    const itemsRes = await query(
      `SELECT * FROM signage_playlist_items WHERE playlist_id = $1 ORDER BY sort_order`,
      [device.playlist_id]
    );

    const currentHour = new Date().getHours();
    const currentDay = new Date().getDay() === 0 ? 7 : new Date().getDay(); // 1=Pzt..7=Paz

    const resolved = [];
    for (const item of itemsRes.rows) {
      if (item.day_of_week && !item.day_of_week.includes(currentDay)) continue;
      if (item.start_hour != null && item.end_hour != null) {
        if (currentHour < item.start_hour || currentHour >= item.end_hour) continue;
      }

      let media = null;
      if (item.content_type === 'custom_media') {
        media = { type: 'image', url: item.media_url, title: null };
      } else if (item.content_type === 'ad' && item.reference_id) {
        const r = await query('SELECT creative_type, creative_url FROM ads WHERE id = $1 AND is_active = true', [item.reference_id]);
        if (r.rows[0]) media = { type: r.rows[0].creative_type, url: r.rows[0].creative_url, title: null };
      } else if (item.content_type === 'campaign' && item.reference_id) {
        const r = await query('SELECT title, banner_url, video_url FROM campaigns WHERE id = $1 AND is_active = true', [item.reference_id]);
        if (r.rows[0]) media = { type: r.rows[0].video_url ? 'video' : 'image', url: r.rows[0].video_url || r.rows[0].banner_url, title: r.rows[0].title };
      } else if (item.content_type === 'popup' && item.reference_id) {
        const r = await query('SELECT title, media_type, media_url FROM mall_popups WHERE id = $1 AND is_active = true', [item.reference_id]);
        if (r.rows[0]) media = { type: r.rows[0].media_type, url: r.rows[0].media_url, title: r.rows[0].title };
      }

      if (media && media.url) resolved.push({ id: item.id, durationSeconds: item.duration_seconds, media });
    }

    res.json({ device: { name: device.name, mallName: device.mall_name, orientation: device.orientation }, items: resolved });
  } catch (err) { next(err); }
});

module.exports = router;
