// backend/routes/admin/billing.js
//
// mall_admin'in kendi AVM'sinin planını/aboneliğini yönettiği uçlar.
// scopeToMall zaten server.js'te bu router'dan önce uygulanıyor, bu yüzden
// burada req.mall.id her zaman doludur.

const express = require('express');
const crypto = require('crypto');
const { query } = require('../../db/pool');
const { recordAudit } = require('../../services/auditLog');
const { initializeCheckoutForm } = require('../../services/iyzico');

const router = express.Router();

// GET /api/admin/billing — güncel plan, abonelik durumu, son faturalar
router.get('/billing', async (req, res, next) => {
  try {
    const mallRes = await query(
      `SELECT m.status, m.trial_ends_at, m.current_period_end,
              p.id AS plan_id, p.code AS plan_code, p.name AS plan_name,
              p.max_stores, p.max_floors, p.max_admins, p.monthly_price, p.features
       FROM malls m LEFT JOIN plans p ON p.id = m.plan_id
       WHERE m.id = $1`,
      [req.mall.id]
    );
    const invoicesRes = await query(
      `SELECT id, amount, currency, status, period_start, period_end, paid_at, created_at,
              (SELECT code FROM plans WHERE id = invoices.plan_id) AS plan_code
       FROM invoices WHERE mall_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.mall.id]
    );
    res.json({ subscription: mallRes.rows[0] || null, invoices: invoicesRes.rows });
  } catch (err) { next(err); }
});

// GET /api/admin/billing/plans — yükseltme/düşürme için mevcut planlar
router.get('/billing/plans', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, code, name, max_stores, max_floors, max_admins, ad_slots_included, monthly_price, features
       FROM plans ORDER BY monthly_price ASC`
    );
    res.json({ plans: rows });
  } catch (err) { next(err); }
});

// POST /api/admin/billing/checkout  { planId }
// iyzico hosted checkout formunu başlatır ve ödeme sayfası URL'sini döner.
router.post('/billing/checkout', async (req, res, next) => {
  try {
    const { planId } = req.body;
    if (!planId) return res.status(400).json({ error: 'planId zorunludur.' });

    const planRes = await query('SELECT * FROM plans WHERE id = $1', [planId]);
    const plan = planRes.rows[0];
    if (!plan) return res.status(404).json({ error: 'Plan bulunamadı.' });

    const mallRes = await query('SELECT name, city, address FROM malls WHERE id = $1', [req.mall.id]);
    const mall = mallRes.rows[0];
    const userRes = await query('SELECT email, full_name FROM users WHERE id = $1', [req.user.id]);
    const buyerUser = userRes.rows[0];

    const periodStart = new Date();
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const conversationId = crypto.randomUUID();
    const inserted = await query(
      `INSERT INTO invoices (mall_id, plan_id, amount, currency, status, period_start, period_end, provider, conversation_id)
       VALUES ($1,$2,$3,'TRY','pending',$4,$5,'iyzico',$6) RETURNING id`,
      [req.mall.id, plan.id, plan.monthly_price, periodStart, periodEnd, conversationId]
    );
    const invoiceId = inserted.rows[0].id;

    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    const callbackUrl = `${baseUrl}/api/billing/iyzico/callback`;

    const result = await initializeCheckoutForm({
      conversationId,
      price: plan.monthly_price,
      currency: 'TRY',
      callbackUrl,
      buyer: {
        id: req.user.id,
        name: (buyerUser?.full_name || 'AVM').split(' ')[0] || 'AVM',
        surname: (buyerUser?.full_name || 'Yönetici').split(' ').slice(1).join(' ') || 'Yönetici',
        email: buyerUser?.email,
        identityNumber: '11111111111', // Not: gerçek entegrasyonda AVM faturalama profilinden alınmalı.
        registrationAddress: mall?.address || mall?.name,
        city: mall?.city || 'İstanbul',
        country: 'Türkiye',
        ip: req.ip,
      },
      basketItems: [{
        id: plan.id,
        name: `SmartWay AVM — ${plan.name} (aylık abonelik)`,
        category1: 'SaaS',
        itemType: 'VIRTUAL',
        price: plan.monthly_price,
      }],
    });

    if (result.status !== 'success') {
      await query(`UPDATE invoices SET status = 'failed', failure_reason = $2 WHERE id = $1`, [invoiceId, result.errorMessage || 'iyzico checkout başlatılamadı.']);
      return res.status(502).json({ error: result.errorMessage || 'Ödeme başlatılamadı, lütfen tekrar deneyin.' });
    }

    await query(`UPDATE invoices SET checkout_token = $2 WHERE id = $1`, [invoiceId, result.token]);
    await recordAudit({ req, entity: 'invoice', entityId: invoiceId, action: 'checkout_started', diff: { planCode: plan.code } });

    res.json({ paymentPageUrl: result.paymentPageUrl, checkoutFormContent: result.checkoutFormContent, invoiceId });
  } catch (err) { next(err); }
});

module.exports = router;
