// backend/routes/superadmin/index.js
const express = require('express');
const { query } = require('../../db/pool');
const { hashPassword } = require('../../services/auth');
const { recordAudit } = require('../../services/auditLog');
const { handleDbError, isStrongEnoughPassword } = require('../../services/validation');

const router = express.Router();

// GET /api/superadmin/malls — tüm AVM'ler (platform geneli)
router.get('/malls', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT m.id, m.slug, m.name, m.city, m.status, m.created_at, p.name AS plan_name,
              (SELECT count(*) FROM stores s WHERE s.mall_id = m.id AND s.is_active) AS store_count
       FROM malls m LEFT JOIN plans p ON p.id = m.plan_id
       ORDER BY m.created_at DESC`
    );
    res.json({ malls: rows });
  } catch (err) { next(err); }
});

// POST /api/superadmin/malls — yeni AVM onboarding (mall + ilk mall_admin kullanıcısı)
router.post('/malls', async (req, res, next) => {
  const client = await require('../../db/pool').pool.connect();
  try {
    const { slug, name, city, planCode, adminEmail, adminPassword, adminName } = req.body;
    if (!slug || !name || !adminEmail || !adminPassword) {
      return res.status(400).json({ error: 'slug, name, adminEmail, adminPassword zorunludur.' });
    }
    if (!isStrongEnoughPassword(adminPassword)) {
      return res.status(400).json({ error: 'Şifre en az 8 karakter olmalıdır.' });
    }
    const plan = await query('SELECT id FROM plans WHERE code = $1', [planCode || 'starter']);

    await client.query('BEGIN');
    const mallRes = await client.query(
      `INSERT INTO malls (slug, name, city, plan_id, status, trial_ends_at)
       VALUES ($1,$2,$3,$4,'trial', now() + interval '14 day') RETURNING *`,
      [slug, name, city, plan.rows[0]?.id || null]
    );
    const mall = mallRes.rows[0];

    const hash = await hashPassword(adminPassword);
    await client.query(
      `INSERT INTO users (mall_id, email, password_hash, full_name, role)
       VALUES ($1,$2,$3,$4,'mall_admin')`,
      [mall.id, adminEmail.toLowerCase().trim(), hash, adminName || `${name} Yöneticisi`]
    );
    await client.query('COMMIT');

    await recordAudit({ req, entity: 'mall', entityId: mall.id, action: 'create', diff: { slug, name } });
    res.status(201).json({ mall });
  } catch (err) {
    await client.query('ROLLBACK');
    handleDbError(err, res, next);
  } finally {
    client.release();
  }
});

// PATCH /api/superadmin/malls/:id — durum/plan değiştir (askıya al, plan yükselt)
router.patch('/malls/:id', async (req, res, next) => {
  try {
    const { status, planCode } = req.body;
    let planId = null;
    if (planCode) {
      const plan = await query('SELECT id FROM plans WHERE code = $1', [planCode]);
      planId = plan.rows[0]?.id || null;
    }
    const { rows } = await query(
      `UPDATE malls SET status = COALESCE($1, status), plan_id = COALESCE($2, plan_id), updated_at = now()
       WHERE id = $3 RETURNING *`,
      [status, planId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'AVM bulunamadı.' });
    await recordAudit({ req, entity: 'mall', entityId: req.params.id, action: 'update', diff: req.body });
    res.json({ mall: rows[0] });
  } catch (err) { next(err); }
});

// GET /api/superadmin/plans
router.get('/plans', async (_req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM plans ORDER BY monthly_price');
    res.json({ plans: rows });
  } catch (err) { next(err); }
});

// --------------------------------------------------------------------
// FATURA
// --------------------------------------------------------------------
router.get('/invoices', async (req, res, next) => {
  try {
    const { mallId } = req.query;
    const { rows } = await query(
      `SELECT i.*, m.name AS mall_name FROM invoices i JOIN malls m ON m.id = i.mall_id
       ${mallId ? 'WHERE i.mall_id = $1' : ''} ORDER BY i.created_at DESC LIMIT 200`,
      mallId ? [mallId] : []
    );
    res.json({ invoices: rows });
  } catch (err) { next(err); }
});

router.post('/invoices', async (req, res, next) => {
  try {
    const { mallId, amount, currency, periodStart, periodEnd } = req.body;
    if (!mallId || !amount || !periodStart || !periodEnd) {
      return res.status(400).json({ error: 'mallId, amount, periodStart, periodEnd zorunludur.' });
    }
    const { rows } = await query(
      `INSERT INTO invoices (mall_id, amount, currency, period_start, period_end)
       VALUES ($1,$2,COALESCE($3,'TRY'),$4,$5) RETURNING *`,
      [mallId, amount, currency, periodStart, periodEnd]
    );
    res.status(201).json({ invoice: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/invoices/:id/mark-paid', async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Fatura bulunamadı.' });
    res.json({ invoice: rows[0] });
  } catch (err) { next(err); }
});

// --------------------------------------------------------------------
// DESTEK TALEPLERİ
// --------------------------------------------------------------------
router.get('/support-tickets', async (req, res, next) => {
  try {
    const { status } = req.query;
    const { rows } = await query(
      `SELECT t.*, m.name AS mall_name FROM support_tickets t JOIN malls m ON m.id = t.mall_id
       ${status ? 'WHERE t.status = $1' : ''} ORDER BY t.created_at DESC`,
      status ? [status] : []
    );
    res.json({ tickets: rows });
  } catch (err) { next(err); }
});

router.patch('/support-tickets/:id', async (req, res, next) => {
  try {
    const { status } = req.body;
    const { rows } = await query(
      `UPDATE support_tickets SET status = COALESCE($1, status) WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Destek talebi bulunamadı.' });
    res.json({ ticket: rows[0] });
  } catch (err) { next(err); }
});

// --------------------------------------------------------------------
// PLATFORM GENELİ ÖZET
// --------------------------------------------------------------------
router.get('/overview', async (_req, res, next) => {
  try {
    const [malls, stores, mrr, tickets] = await Promise.all([
      query(`SELECT count(*) FROM malls WHERE status = 'active'`),
      query(`SELECT count(*) FROM stores WHERE is_active`),
      query(`SELECT COALESCE(sum(p.monthly_price),0) AS mrr FROM malls m JOIN plans p ON p.id = m.plan_id WHERE m.status = 'active'`),
      query(`SELECT count(*) FROM support_tickets WHERE status = 'open'`),
    ]);
    res.json({
      activeMalls: +malls.rows[0].count,
      activeStores: +stores.rows[0].count,
      mrr: +mrr.rows[0].mrr,
      openTickets: +tickets.rows[0].count,
    });
  } catch (err) { next(err); }
});

module.exports = router;
