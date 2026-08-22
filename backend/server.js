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

// Güvenlik ağı: beklenmeyen bir yakalanmamış hata/promise reddi (tıpkı
// trust-proxy hatasında olduğu gibi) modern Node sürümlerinde tüm süreci
// sessizce sonlandırabilir. Bunun yerine hatayı görünür şekilde loglayıp
// süreci ayakta tutuyoruz — tek bir isteğin hatası tüm servisi düşürmesin.
const monitoring = require('./services/monitoring');
monitoring.init();
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  if (reason instanceof Error) monitoring.captureError(reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  monitoring.captureError(err);
});

const { resolveTenant } = require('./middleware/tenant');
const { query } = require('./db/pool');
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
const adminBillingRoutes = require('./routes/admin/billing');
const billingCallbackRoutes = require('./routes/billing/callback');
const myStoreRoutes = require('./routes/store/mystore');
const superAdminRoutes = require('./routes/superadmin');
const loyaltyRoutes = require('./routes/loyalty');
const privacyRoutes = require('./routes/privacy');
const signageRoutes = require('./routes/signage');
const publicV1Routes = require('./routes/public/v1');

const app = express();
const PORT = process.env.PORT || 4000;

// Bir ters proxy (nginx/Cloudflare vb.) arkasında çalışırken gerçek istemci
// IP'sinin doğru okunması için (rate limit'in etkili olması adına).
// Render (ve genel olarak neredeyse tüm PaaS sağlayıcıları) her isteği bir
// ters proxy üzerinden yönlendirir ve X-Forwarded-For başlığı ekler. Bu
// ayar kapalıyken express-rate-limit her istekte bir ValidationError
// fırlatır (yakalanmamış promise reddi → sürecin zaman zaman çökmesine/
// yeniden başlamasına, dolayısıyla rastgele 401'lere yol açabilir). Bu
// yüzden production'da veya TRUST_PROXY=true iken KOŞULSUZ etkinleştirilir
// — ekstra bir ortam değişkeni unutulsa bile production'da güvenli çalışır.
if (process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// --- Güvenlik & performans ---------------------------------------------
//
// CSP (Content-Security-Policy): varsayılan helmet() ayarları yerine burada
// bilinçli bir politika tanımlanır. Frontend'de (bkz. frontend/public)
// inline <script> kullanılmıyor (tüm JS harici dosyalarda) — bu yüzden
// script-src'de 'unsafe-inline' YOK. style-src'de birkaç yerde hâlâ inline
// style="..." attribute'u kullanıldığından (ve Google Fonts'un ürettiği
// <style> bloğu için) 'unsafe-inline' gerekli; ileride bu satır-stiller
// CSS sınıflarına taşınırsa buradan kaldırılabilir.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
}));

// CORS: ziyaretçi PWA / kiosk / üçüncü-parti public API uçları geniş
// erişime açık kalır (bunlar zaten JWT gerektirmez ya da X-API-Key ile
// korunur). Ancak yönetim panelleri (/api/admin, /api/store, /api/superadmin)
// yalnızca ALLOWED_ORIGINS ortam değişkeninde tanımlı origin'lerden
// çağrılabilmelidir — bu, açık bir CORS politikasının (kendi başına düşük
// risk taşısa da, JWT localStorage'da tutulduğu için XSS senaryolarında
// ikinci bir savunma katmanı olarak) sertleştirilmesidir.
app.use(cors());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  // eslint-disable-next-line no-console
  console.warn('[cors] UYARI: ALLOWED_ORIGINS tanımlı değil — yönetim panel API\'leri şu an tüm origin\'lere açık. Production\'da bu değişkenin (örn. https://app.smartwayavm.com) set edilmesi önerilir.');
}

const adminCors = cors({
  origin(origin, callback) {
    // origin=undefined → tarayıcı-dışı istek (curl, sunucu-sunucu) ya da
    // aynı-origin istek; her ikisi de zaten CORS kapsamı dışındadır.
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    const err = new Error('CORS: bu origin\'e izin verilmiyor.');
    err.status = 403;
    return callback(err);
  },
  credentials: true,
});

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

const { createRateLimitStore } = require('./services/rateLimitStore');

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // dakikada IP başına istek
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('api'),
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
  store: createRateLimitStore('auth'),
});
app.use('/api/auth/login', authLimiter);

// Parola sıfırlama isteği de aynı brute-force/enumeration riskini taşır
// (biri art arda farklı e-postalar deneyerek hangilerinin kayıtlı olduğunu
// zamanlama/miktar üzerinden çıkarmaya çalışabilir) — aynı sıkı limit uygulanır.
app.use('/api/auth/forgot-password', authLimiter);

// --- Statik dosyalar (Ziyaretçi PWA + Admin panelleri) ------------------
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

// --- Sağlık kontrolü -----------------------------------------------------
// /healthz: yük dengeleyici/uptime monitoring probe'ları için. Yalnızca
// process'in ayakta olduğunu değil, veritabanına gerçekten bağlanabildiğini
// de doğrular — aksi halde "process çalışıyor ama DB'ye erişemiyor" durumu
// yanlışlıkla "healthy" raporlanırdı.
app.get('/healthz', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: 'db_unreachable', time: new Date().toISOString() });
  }
});

// --- Dinamik PWA manifest'i: "Ana ekrana ekle" doğru AVM'ye açılsın diye ---
// Statik dosyadan ÖNCE tanımlanmalı (Express ilk eşleşen route'u kullanır),
// ?mall= verilmişse start_url o AVM'nin temiz URL'ine ayarlanır.
app.get('/manifest.json', (req, res) => {
  const mall = req.query.mall;
  res.json({
    name: 'SmartWay AVM',
    short_name: 'SmartWay',
    description: 'QR tabanlı akıllı AVM yönlendirme ve reklam platformu',
    start_url: mall ? `/${mall}` : '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#F6F3EC',
    theme_color: '#141311',
    icons: [
      { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
    ],
  });
});

// --- Kimlik doğrulama (tenant bağımsız, kendi route'ları içinde gerektiğinde requireAuth uygular) ---
// Login/refresh/forgot-password/reset-password yalnızca yönetim
// panellerinden çağrıldığından adminCors (ALLOWED_ORIGINS allow-list) ile
// korunur (tanım yukarıda, "Güvenlik & performans" bölümünde).
app.use('/api', adminCors, authRoutes);

// --- Yetki gerektiren paneller: ÖZGÜN ve BENZERSİZ öneklerle bağlanır -----
// (Önemli: bu mount'lar geniş '/api' ziyaretçi mount'undan ÖNCE tanımlanmalı;
//  aksi halde resolveTenant/requireAuth gibi blanket middleware'ler prefix
//  çakışması yüzünden ilgisiz istekleri de yanlışlıkla yakalar.)
const adminAuth = [adminCors, requireAuth, requireRole('mall_admin', 'super_admin'), scopeToMall];
app.use('/api/admin', adminAuth, adminFloorsRoutes);
app.use('/api/admin', adminAuth, adminStoresRoutes);
app.use('/api/admin', adminAuth, adminCampaignsRoutes);
app.use('/api/admin', adminAuth, adminAdsRoutes);
app.use('/api/admin', adminAuth, adminAnalyticsRoutes);
app.use('/api/admin', adminAuth, adminMiscRoutes);
app.use('/api/admin', adminAuth, adminSignageRoutes);
app.use('/api/admin', adminAuth, adminIntegrationsRoutes);
app.use('/api/admin', adminAuth, adminBillingRoutes);

// GÜVENLİK: iyzico callback'i BİLİNÇLİ OLARAK adminCors/requireAuth
// zincirinin DIŞINDA tutulur — kullanıcının tarayıcısı buraya iyzico'nun
// kendi sayfasından bir top-level form POST/redirect ile gelir, bizim
// JWT'imizi ya da ALLOWED_ORIGINS origin'ini taşımaz. Yetkilendirme
// yerine, callback handler'ın kendisi token'ı iyzico'ya sunucu-sunucu
// tekrar sorgulayarak doğrular (bkz. routes/billing/callback.js).
app.use('/api/billing', billingCallbackRoutes);

app.use('/api/store', adminCors, requireAuth, requireRole('store_manager'), scopeToMall, myStoreRoutes);
app.use('/api/superadmin', adminCors, requireAuth, requireRole('super_admin'), superAdminRoutes);

// --- Üçüncü parti entegratörler: API anahtarı ile korunan herkese açık API ---
app.use('/api/public', requireApiKey, publicV1Routes);

// --- Kiosk/Signage: pairing_code ile kendi kendine kimliklenir (JWT gerekmez) ---
app.use('/api', signageRoutes);

// --- Tenant çözümlemesi gereken ZİYARETÇİ API'leri (geniş '/api' öneki EN SONDA) ---
app.use('/api', resolveTenant, navigationRoutes);
app.use('/api', resolveTenant, storeRoutes);
app.use('/api', resolveTenant, loyaltyRoutes);
app.use('/api', resolveTenant, privacyRoutes);

// --- 404 ------------------------------------------------------------------
app.use('/api', (_req, res) => res.status(404).json({ error: 'Uç nokta bulunamadı.' }));

// --- TEMİZ AVM URL'İ: navirota.com/iyasparkavm gibi --------------------------
// Ziyaretçi PWA'sı normalde ?mall=slug query param'ı ile çalışır; bu route,
// tek segmentli bir path'i (örn. /iyasparkavm) AVM slug'ı olarak yorumlayıp
// aynı index.html'i sunar — asıl slug çözümlemesi tarayıcıda app.js
// tarafından URL path'inden okunur (bkz. frontend/public/js/app.js).
// Yalnızca gerçek bir statik dosya/klasörle (js, css, admin, icons, api vb.)
// ÇAKIŞMAYAN istekler buraya düşer, çünkü express.static bu route'tan ÖNCE
// tanımlıdır ve var olan dosyaları zaten kendisi sunar.
const RESERVED_TOP_LEVEL_PATHS = new Set(['admin', 'api', 'js', 'css', 'icons', 'docs', 'healthz', 'kiosk.html', 'manifest.json', 'service-worker.js']);
app.get('/:mallSlug', (req, res, next) => {
  const slug = req.params.mallSlug;
  if (slug.includes('.') || RESERVED_TOP_LEVEL_PATHS.has(slug)) return next(); // dosya isteği ya da ayrılmış yol — normal 404 akışına düş
  res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'index.html'));
});

// --- Hata yakalayıcı --------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  monitoring.captureError(err);
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

const httpServer = app.listen(PORT, () => {
  console.log(`SmartWay AVM API çalışıyor → http://localhost:${PORT}`);
});

// Zarif kapanış: BullMQ worker'ı (bkz. services/webhookQueue.js) açık bir
// Redis bağlantısı tutar — process SIGTERM/SIGINT ile sonlandırılırken
// (örn. deploy sırasında Render/Docker tarafından) bu bağlantı düzgün
// kapatılmazsa yarım kalmış bir job'ın kaybolmasına ya da bağlantı
// sızıntısına yol açabilir.
async function gracefulShutdown(signal) {
  console.log(`[shutdown] ${signal} alındı, kapanılıyor...`);
  const { closeWebhookQueue } = require('./services/webhookQueue');
  await closeWebhookQueue().catch(() => {});
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref(); // 10sn içinde kapanmazsa zorla çık
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
