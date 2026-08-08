// backend/routes/auth.js
const express = require('express');
const { query } = require('../db/pool');
const {
  verifyPassword, signAccessToken, generateRefreshToken, hashRefreshToken,
} = require('../services/auth');
const { requireAuth } = require('../middleware/auth');
const { recordAudit } = require('../services/auditLog');

const router = express.Router();

// POST /api/auth/login  { email, password }
router.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'E-posta ve şifre zorunludur.' });

    const { rows } = await query(
      `SELECT id, mall_id, store_id, email, password_hash, full_name, role, is_active
       FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user || !user.is_active) return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });

    const accessToken = signAccessToken(user);
    const { raw, hash, expiresAt } = generateRefreshToken();
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
      [user.id, hash, expiresAt]
    );

    let mallSlug = null;
    if (user.mall_id) {
      const m = await query('SELECT slug FROM malls WHERE id = $1', [user.mall_id]);
      mallSlug = m.rows[0]?.slug || null;
    }

    recordAudit({ req: { user: { id: user.id, role: user.role }, mall: { id: user.mall_id }, ip: req.ip }, entity: 'auth', action: 'login' });

    res.json({
      accessToken,
      refreshToken: raw,
      user: {
        id: user.id, email: user.email, fullName: user.full_name, role: user.role,
        mallId: user.mall_id, storeId: user.store_id, mallSlug,
      },
    });
  } catch (err) { next(err); }
});

// POST /api/auth/refresh  { refreshToken }
router.post('/auth/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken zorunludur.' });
    const hash = hashRefreshToken(refreshToken);

    const { rows } = await query(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.role, u.mall_id, u.store_id, u.is_active
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [hash]
    );
    const rec = rows[0];
    if (!rec || rec.revoked_at || new Date(rec.expires_at) < new Date() || !rec.is_active) {
      return res.status(401).json({ error: 'Oturum geçersiz, yeniden giriş yapın.' });
    }

    const accessToken = signAccessToken({ id: rec.user_id, role: rec.role, mall_id: rec.mall_id, store_id: rec.store_id });
    res.json({ accessToken });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.full_name, u.role, u.mall_id, u.store_id, m.slug AS mall_slug, m.name AS mall_name
       FROM users u LEFT JOIN malls m ON m.id = u.mall_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/auth/logout  { refreshToken }
router.post('/auth/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, [hashRefreshToken(refreshToken)]);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
