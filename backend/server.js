// backend/server.js
// SmartWay AVM — API sunucusu.
// Mimari: Express + PostgreSQL, tamamen QR/SVG tabanlı, ek donanım yok.

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { resolveTenant } = require('./middleware/tenant');
const { requireAuth, requireRole, scopeToMall } = require('./middleware/auth');
const { requireApiKey } = require('./middleware/apiKeyAuth');
const navigationRoutes = require('./routes/navigation');
const storeRoutes = require('./routes/stores');
const authRoutes = require('./routes/auth');
const adminFloorsRoutes = require('./routes/admin/floors');
const adminStoresRoutes = require('./routes/admin/stores');
const adminCampaignsRoutes = require('./routes/admin/campaigns');
const adminAdsRoutes = require('./routes/admin/ads');
const adminAnalyticsRoutes = require('./routes/admin/analytics');
const adminMiscRoutes = require('./routes/admin/misc');
const adminSignageRoutes = require('./routes/admin/signage');
const adminIntegrationsRoutes = require('./routes/admin/integrations');
const myStoreRoutes = require('./routes/store/mystore');
const superAdminRoutes = require('./routes/superadmin');
const loyaltyRoutes = require('./routes/loyalty');
const signageRoutes = require('./routes/signage');
const publicV1Routes = require('./routes/public/v1');

const app = express();
const PORT = process.env.PORT || 4000;

// Bir ters proxy (nginx/Cloudflare vb.) arkasında çalışırken gerçek istemci
// IP'sinin doğru okunması için (rate limit'in etkili olması adına).
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

// --- Güvenlik & performans ---------------------------------------------
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '2mb' }));

// express.json() body-parser hatalarını (bozuk JSON) net bir 400'e çevirir;
// aksi halde genel hata yakalayıcıya düşüp 500 gibi yanlış bir izlenim verirdi.
app.use((err, _req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'İstek gövdesi geçerli bir JSON değil.' });
  }
  next(err);
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // dakikada IP başına istek
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// Kimlik doğrulama uçları için ayrıca sıkı bir limit — brute-force şifre
// denemelerine karşı (genel 120/dk limiti bu amaç için yetersiz kalır).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 15 dakikada IP başına en fazla 20 giriş denemesi
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla giriş denemesi yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.' },
});
app.use('/api/auth/login', authLimiter);

// --- Statik dosyalar (Ziyaretçi PWA + Admin panelleri) ------------------
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

// --- Sağlık kontrolü -----------------------------------------------------
app.get('/healthz', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// --- Kimlik doğrulama (tenant bağımsız, kendi route'ları içinde gerektiğinde requireAuth uygular) ---
app.use('/api', authRoutes);

// --- Yetki gerektiren paneller: ÖZGÜN ve BENZERSİZ öneklerle bağlanır -----
// (Önemli: bu mount'lar geniş '/api' ziyaretçi mount'undan ÖNCE tanımlanmalı;
//  aksi halde resolveTenant/requireAuth gibi blanket middleware'ler prefix
//  çakışması yüzünden ilgisiz istekleri de yanlışlıkla yakalar.)
const adminAuth = [requireAuth, requireRole('mall_admin', 'super_admin'), scopeToMall];
app.use('/api/admin', adminAuth, adminFloorsRoutes);
app.use('/api/admin', adminAuth, adminStoresRoutes);
app.use('/api/admin', adminAuth, adminCampaignsRoutes);
app.use('/api/admin', adminAuth, adminAdsRoutes);
app.use('/api/admin', adminAuth, adminAnalyticsRoutes);
app.use('/api/admin', adminAuth, adminMiscRoutes);
app.use('/api/admin', adminAuth, adminSignageRoutes);
app.use('/api/admin', adminAuth, adminIntegrationsRoutes);

app.use('/api/store', requireAuth, requireRole('store_manager'), scopeToMall, myStoreRoutes);
app.use('/api/superadmin', requireAuth, requireRole('super_admin'), superAdminRoutes);

// --- Üçüncü parti entegratörler: API anahtarı ile korunan herkese açık API ---
app.use('/api/public', requireApiKey, publicV1Routes);

// --- Kiosk/Signage: pairing_code ile kendi kendine kimliklenir (JWT gerekmez) ---
app.use('/api', signageRoutes);

// --- Tenant çözümlemesi gereken ZİYARETÇİ API'leri (geniş '/api' öneki EN SONDA) ---
app.use('/api', resolveTenant, navigationRoutes);
app.use('/api', resolveTenant, storeRoutes);
app.use('/api', resolveTenant, loyaltyRoutes);

// --- 404 ------------------------------------------------------------------
app.use('/api', (_req, res) => res.status(404).json({ error: 'Uç nokta bulunamadı.' }));

// --- Hata yakalayıcı --------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  // 4xx hatalar bilinçli/beklenen doğrulama mesajlarıdır, güvenle gösterilir.
  // 5xx (beklenmeyen) hatalarda, production'da iç detayları (stack/sorgu
  // metni vb. içerebilir) istemciye sızdırmamak için genel bir mesaj döneriz;
  // gerçek detay yalnızca sunucu logunda (yukarıdaki console.error) kalır.
  const isClientError = status >= 400 && status < 500;
  const message = isClientError || process.env.NODE_ENV !== 'production'
    ? (err.message || 'Sunucu hatası.')
    : 'Sunucu hatası. Lütfen daha sonra tekrar deneyin.';
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`SmartWay AVM API çalışıyor → http://localhost:${PORT}`);
});

module.exports = app;
