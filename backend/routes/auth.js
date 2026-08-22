// backend/routes/auth.js
const express = require('express');
const { query } = require('../db/pool');
const {
  verifyPassword, hashPassword, signAccessToken, generateRefreshToken, hashRefreshToken,
  generatePasswordResetToken, hashPasswordResetToken,
} = require('../services/auth');
const { requireAuth } = require('../middleware/auth');
const { recordAudit } = require('../services/auditLog');
const { sendPasswordResetEmail } = require('../services/email');
const { isStrongEnoughPassword } = require('../services/validation');

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
//
// GÜVENLİK — Rotasyon + yeniden-kullanım (reuse) tespiti:
// Her başarılı refresh'te eski token İPTAL EDİLİR ve yeni bir refresh token
// verilir (tek kullanımlıktır). Eğer daha önce zaten rotasyona uğramış
// (revoked_reason='rotated') bir token TEKRAR sunulursa, bu token'ın bir
// başkası tarafından çalınıp kullanılmış olabileceğinin işaretidir —
// bu durumda kullanıcının TÜM oturumları (tüm refresh token'ları) iptal
// edilir ve yeniden giriş zorunlu kılınır. Böylece bir refresh token
// sızarsa saldırgan süresiz (30 gün) sessizce kullanmaya devam edemez.
router.post('/auth/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken zorunludur.' });
    const hash = hashRefreshToken(refreshToken);

    const { rows } = await query(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, rt.revoked_reason,
              u.role, u.mall_id, u.store_id, u.is_active
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [hash]
    );
    const rec = rows[0];
    if (!rec) return res.status(401).json({ error: 'Oturum geçersiz, yeniden giriş yapın.' });

    if (rec.revoked_at) {
      // Zaten rotasyona uğramış (ya da çıkış yapılmış) bir token'ın tekrar
      // kullanılmaya çalışılması — olası hırsızlık, tüm oturumları iptal et.
      if (rec.revoked_reason === 'rotated') {
        await query(
          `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'reuse_detected'
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [rec.user_id]
        );
        recordAudit({ req: { user: { id: rec.user_id, role: rec.role }, mall: { id: rec.mall_id }, ip: req.ip }, entity: 'auth', action: 'refresh_token_reuse_detected' });
      }
      return res.status(401).json({ error: 'Oturum geçersiz, yeniden giriş yapın.' });
    }

    if (new Date(rec.expires_at) < new Date() || !rec.is_active) {
      return res.status(401).json({ error: 'Oturum geçersiz, yeniden giriş yapın.' });
    }

    const accessToken = signAccessToken({ id: rec.user_id, role: rec.role, mall_id: rec.mall_id, store_id: rec.store_id });
    const { raw, hash: newHash, expiresAt } = generateRefreshToken();
    const { rows: inserted } = await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3) RETURNING id`,
      [rec.user_id, newHash, expiresAt]
    );
    await query(
      `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'rotated', replaced_by = $2 WHERE id = $1`,
      [rec.id, inserted[0].id]
    );

    res.json({ accessToken, refreshToken: raw });
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
      await query(
        `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'logout'
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashRefreshToken(refreshToken)]
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/auth/forgot-password  { email }
//
// GÜVENLİK: Yanıt, e-posta sistemde kayıtlı olsa da olmasa da HER ZAMAN
// aynı jenerik mesajı döner — aksi halde bu uç nokta "hangi e-postalar
// kayıtlı" sorusuna cevap veren bir kullanıcı numaralandırma (enumeration)
// aracına dönüşür.
router.post('/auth/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'E-posta zorunludur.' });

    const generic = { ok: true, message: 'Bu e-posta sistemde kayıtlıysa, parola sıfırlama bağlantısı gönderildi.' };

    const { rows } = await query(
      'SELECT id, email, is_active FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user || !user.is_active) return res.json(generic); // enumeration önleme: yine de 200

    const { raw, hash, expiresAt } = generatePasswordResetToken();
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
      [user.id, hash, expiresAt]
    );

    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${baseUrl}/admin/reset-password.html?token=${raw}`;
    await sendPasswordResetEmail(user.email, resetUrl);

    recordAudit({ req: { user: { id: user.id, role: null }, mall: { id: null }, ip: req.ip }, entity: 'auth', action: 'password_reset_requested' });

    res.json(generic);
  } catch (err) { next(err); }
});

// POST /api/auth/reset-password  { token, newPassword }
//
// Başarılı sıfırlamadan sonra kullanıcının TÜM refresh token'ları iptal
// edilir — parola sızmışsa, mevcut tüm oturumların da kapatılması gerekir.
router.post('/auth/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'token ve newPassword zorunludur.' });
    if (!isStrongEnoughPassword(newPassword)) {
      return res.status(400).json({ error: 'Parola en az 8 karakter olmalıdır.' });
    }

    const hash = hashPasswordResetToken(token);
    const { rows } = await query(
      `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1`,
      [hash]
    );
    const rec = rows[0];
    if (!rec || rec.used_at || new Date(rec.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Bağlantı geçersiz veya süresi dolmuş. Yeni bir sıfırlama isteği gönderin.' });
    }

    const newHash = await hashPassword(newPassword);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, rec.user_id]);
    await query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [rec.id]);
    await query(
      `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'password_reset'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [rec.user_id]
    );

    recordAudit({ req: { user: { id: rec.user_id, role: null }, mall: { id: null }, ip: req.ip }, entity: 'auth', action: 'password_reset_completed' });

    res.json({ ok: true, message: 'Parolanız güncellendi. Lütfen yeniden giriş yapın.' });
  } catch (err) { next(err); }
});

module.exports = router;
