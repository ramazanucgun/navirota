// backend/routes/admin/integrations.js
const express = require('express');
const crypto = require('crypto');
const { query } = require('../../db/pool');
const { hashApiKey } = require('../../middleware/apiKeyAuth');
const { recordAudit } = require('../../services/auditLog');

const router = express.Router();

// --------------------------------------------------------------------
// API ANAHTARLARI
// --------------------------------------------------------------------
router.get('/api-keys', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, label, key_prefix, scopes, last_used_at, revoked_at, created_at
       FROM api_keys WHERE mall_id = $1 ORDER BY created_at DESC`,
      [req.mall.id]
    );
    res.json({ apiKeys: rows });
  } catch (err) { next(err); }
});

// POST /api/admin/api-keys — yeni anahtar (tam anahtar YALNIZCA bu yanıtta gösterilir)
router.post('/api-keys', async (req, res, next) => {
  try {
    const { label, scopes } = req.body;
    if (!label) return res.status(400).json({ error: 'label zorunludur.' });

    const rawKey = `sw_live_${crypto.randomBytes(24).toString('hex')}`;
    const prefix = rawKey.slice(0, 12);
    const hash = hashApiKey(rawKey);

    const { rows } = await query(
      `INSERT INTO api_keys (mall_id, label, key_prefix, key_hash, scopes)
       VALUES ($1,$2,$3,$4,COALESCE($5, ARRAY['read'])) RETURNING id, label, key_prefix, scopes, created_at`,
      [req.mall.id, label, prefix, hash, scopes]
    );
    await recordAudit({ req, entity: 'api_key', entityId: rows[0].id, action: 'create', diff: { label } });
    res.status(201).json({ apiKey: rows[0], rawKey }); // rawKey yalnızca bir kez gösterilir
  } catch (err) { next(err); }
});

router.delete('/api-keys/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND mall_id = $2 RETURNING id`,
      [req.params.id, req.mall.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Anahtar bulunamadı.' });
    await recordAudit({ req, entity: 'api_key', entityId: req.params.id, action: 'delete' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// --------------------------------------------------------------------
// WEBHOOK'LAR
// --------------------------------------------------------------------
const AVAILABLE_EVENTS = ['campaign.created', 'campaign.updated', 'store.created', 'store.updated', 'route.completed'];

router.get('/webhooks', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT w.*, (SELECT count(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.success) AS success_count,
              (SELECT count(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id AND NOT d.success) AS fail_count
       FROM webhooks w WHERE w.mall_id = $1 ORDER BY w.created_at DESC`,
      [req.mall.id]
    );
    res.json({ webhooks: rows, availableEvents: AVAILABLE_EVENTS });
  } catch (err) { next(err); }
});

router.post('/webhooks', async (req, res, next) => {
  try {
    const { targetUrl, events } = req.body;
    if (!targetUrl || !events?.length) return res.status(400).json({ error: 'targetUrl ve events zorunludur.' });
    const invalid = events.filter((e) => !AVAILABLE_EVENTS.includes(e));
    if (invalid.length) return res.status(400).json({ error: `Geçersiz event(ler): ${invalid.join(', ')}` });

    const secret = crypto.randomBytes(20).toString('hex');
    const { rows } = await query(
      `INSERT INTO webhooks (mall_id, target_url, events, secret) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.mall.id, targetUrl, events, secret]
    );
    await recordAudit({ req, entity: 'webhook', entityId: rows[0].id, action: 'create', diff: { targetUrl, events } });
    res.status(201).json({ webhook: rows[0] }); // secret yalnızca bu yanıtta tam gösterilir
  } catch (err) { next(err); }
});

router.patch('/webhooks/:id', async (req, res, next) => {
  try {
    const { isActive } = req.body;
    const { rows } = await query(
      `UPDATE webhooks SET is_active = COALESCE($1, is_active) WHERE id = $2 AND mall_id = $3 RETURNING *`,
      [isActive, req.params.id, req.mall.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Webhook bulunamadı.' });
    res.json({ webhook: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/webhooks/:id', async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM webhooks WHERE id = $1 AND mall_id = $2', [req.params.id, req.mall.id]);
    if (!rowCount) return res.status(404).json({ error: 'Webhook bulunamadı.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/webhooks/:id/deliveries', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT d.* FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
       WHERE d.webhook_id = $1 AND w.mall_id = $2 ORDER BY d.attempted_at DESC LIMIT 30`,
      [req.params.id, req.mall.id]
    );
    res.json({ deliveries: rows });
  } catch (err) { next(err); }
});

module.exports = router;
