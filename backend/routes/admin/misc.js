// backend/routes/admin/misc.js
const express = require('express');
const { query } = require('../../db/pool');
const { hashPassword } = require('../../services/auth');
const { recordAudit } = require('../../services/auditLog');
const { isStrongEnoughPassword } = require('../../services/validation');

const router = express.Router();

// POST /api/admin/support-tickets — mall_admin destek talebi açar
router.post('/support-tickets', async (req, res, next) => {
  try {
    const { subject, message } = req.body;
    if (!subject || !message) return res.status(400).json({ error: 'subject ve message zorunludur.' });
    const { rows } = await query(
      `INSERT INTO support_tickets (mall_id, subject, message) VALUES ($1,$2,$3) RETURNING *`,
      [req.mall.id, subject, message]
    );
    res.status(201).json({ ticket: rows[0] });
  } catch (err) { next(err); }
});

// --------------------------------------------------------------------
// KULLANICI YETKİLERİ (çoklu yönetici desteği)
// --------------------------------------------------------------------

// GET /api/admin/users — AVM'nin tüm kullanıcıları (mall_admin + store_manager'lar)
router.get('/users', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.full_name, u.role, u.is_active, s.name AS store_name
       FROM users u LEFT JOIN stores s ON s.id = u.store_id
       WHERE u.mall_id = $1 ORDER BY u.role, u.full_name`,
      [req.mall.id]
    );
    res.json({ users: rows });
  } catch (err) { next(err); }
});

// POST /api/admin/users — yeni mall_admin ya da store_manager davet et
router.post('/users', async (req, res, next) => {
  try {
    const { email, password, fullName, role, storeId } = req.body;
    if (!email || !password || !role) return res.status(400).json({ error: 'email, password, role zorunludur.' });
    if (!['mall_admin', 'store_manager'].includes(role)) return res.status(400).json({ error: 'Geçersiz rol.' });
    if (!isStrongEnoughPassword(password)) return res.status(400).json({ error: 'Şifre en az 8 karakter olmalıdır.' });

    const hash = await hashPassword(password);
    const { rows } = await query(
      `INSERT INTO users (mall_id, store_id, email, password_hash, full_name, role)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (email) DO NOTHING RETURNING id, email, role, full_name`,
      [req.mall.id, role === 'store_manager' ? storeId : null, email.toLowerCase().trim(), hash, fullName, role]
    );
    if (!rows.length) return res.status(409).json({ error: 'Bu e-posta zaten kayıtlı.' });
    await recordAudit({ req, entity: 'user', entityId: rows[0].id, action: 'create', diff: { email, role } });
    res.status(201).json({ user: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/admin/users/:id — pasifleştir/aktifleştir
router.patch('/users/:id', async (req, res, next) => {
  try {
    const { isActive } = req.body;
    const { rows } = await query(
      `UPDATE users SET is_active = COALESCE($1, is_active) WHERE id = $2 AND mall_id = $3 RETURNING id, is_active`,
      [isActive, req.params.id, req.mall.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    await recordAudit({ req, entity: 'user', entityId: req.params.id, action: 'update', diff: req.body });
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
});

// --------------------------------------------------------------------
// DİJİTAL ÇEKİLİŞ YÖNETİMİ
// --------------------------------------------------------------------
router.get('/raffles', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.*, (SELECT count(*) FROM raffle_entries e WHERE e.raffle_id = r.id) AS entry_count
       FROM raffles r WHERE r.mall_id = $1 ORDER BY r.created_at DESC`,
      [req.mall.id]
    );
    res.json({ raffles: rows });
  } catch (err) { next(err); }
});

router.post('/raffles', async (req, res, next) => {
  try {
    const { title, description, prizeLabel, entryCostPoints, startsAt, endsAt } = req.body;
    if (!title || !startsAt || !endsAt) return res.status(400).json({ error: 'title, startsAt, endsAt zorunludur.' });
    const { rows } = await query(
      `INSERT INTO raffles (mall_id, title, description, prize_label, entry_cost_points, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,COALESCE($5,0),$6,$7) RETURNING *`,
      [req.mall.id, title, description, prizeLabel, entryCostPoints, startsAt, endsAt]
    );
    await recordAudit({ req, entity: 'raffle', entityId: rows[0].id, action: 'create', diff: req.body });
    res.status(201).json({ raffle: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/admin/raffles/:id/draw — rastgele kazanan seç
router.post('/raffles/:id/draw', async (req, res, next) => {
  try {
    const entries = await query('SELECT visitor_id FROM raffle_entries WHERE raffle_id = $1', [req.params.id]);
    if (!entries.rows.length) return res.status(400).json({ error: 'Bu çekilişe henüz katılım yok.' });
    const winner = entries.rows[Math.floor(Math.random() * entries.rows.length)].visitor_id;
    const { rows } = await query(
      `UPDATE raffles SET winner_visitor_id = $1, drawn_at = now(), is_active = false
       WHERE id = $2 AND mall_id = $3 RETURNING *`,
      [winner, req.params.id, req.mall.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Çekiliş bulunamadı.' });
    await recordAudit({ req, entity: 'raffle', entityId: req.params.id, action: 'update', diff: { drawn: true, winner } });
    res.json({ raffle: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
