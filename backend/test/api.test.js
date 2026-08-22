// backend/test/api.test.js
//
// Uçtan uca entegrasyon testleri. Node'un yerleşik `node:test` çalıştırıcısını
// kullanır (ekstra bağımlılık gerekmez). Sunucuyu ayrı bir process olarak
// başlatır, gerçek PostgreSQL'e karşı çalışır.
//
// Önkoşul: `npm run db:migrate && psql ... schema_v2/v3/v4.sql && npm run db:seed`
// çalıştırılmış olmalı (Terrace AVM + demo kullanıcılar mevcut olmalı).
//
// Çalıştırma: node --test test/api.test.js

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

// Bu test dosyası, ayrıca spawn edilen sunucu process'inden BAĞIMSIZ olarak
// birkaç yerde doğrudan veritabanına da bağlanıyor (plan limiti testleri
// gibi geçici durum kurulumları için) — bu yüzden .env burada da
// yüklenmeli, aksi halde DATABASE_URL tanımsız kalır.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PORT = process.env.TEST_PORT || 4321;
const BASE = `http://localhost:${PORT}`;
let serverProcess;

async function waitForServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch { /* henüz ayakta değil */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Sunucu zaman aşımı içinde ayağa kalkmadı.');
}

before(async () => {
  serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    // AI_SEARCH_MOCK=true: LLM katmanının iş mantığını (sözlükte bulunamayan
    // sorguların mock sınıflandırmaya düşmesi) gerçek bir API anahtarı
    // olmadan test edebilmek için (bkz. services/aiSearch.js). Yalnızca
    // sözlüğün HİÇ eşleşme bulamadığı sorgularda devreye girer, mevcut
    // testlerin hiçbirinin sorgu metniyle çakışmaz (kontrol edildi).
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', AI_SEARCH_MOCK: 'true' },
    stdio: 'pipe',
  });
  await waitForServer();
});

after(() => {
  serverProcess?.kill();
});

// Yardımcılar --------------------------------------------------------------
function api(pathname, opts = {}) {
  return fetch(`${BASE}${pathname}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function loginAs(email, password) {
  // Testler arası cache: aynı (email,password) için tekrar tekrar giriş
  // yapmak yerine önbelleklenen sonucu döner. Bu, test paketinin login
  // rate-limit'ine (15 dk'da 20 deneme — kasıtlı bir güvenlik önlemi,
  // bkz. server.js) takılmadan çalışmasını sağlar; rate limit'in kendisi
  // ayrıca kendi özel testinde aşağıda doğrudan doğrulanıyor.
  //
  // NOT: refresh-token rotasyonu/reuse testleri gibi HER SEFERİNDE
  // kullanılmamış, taze bir refreshToken gerektiren yerler bu cache'i
  // KULLANMAMALI — onlar için freshLoginAs() vardır.
  const cacheKey = `${email}:${password}`;
  if (loginAs._cache.has(cacheKey)) return loginAs._cache.get(cacheKey);
  const data = await freshLoginAs(email, password);
  loginAs._cache.set(cacheKey, data);
  return data;
}
loginAs._cache = new Map();

async function freshLoginAs(email, password) {
  const res = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(res.status, 200, `login başarısız: ${email}`);
  return res.json();
}

const MALL = 'terrace';

// ===========================================================================
// SAĞLIK / TEMEL
// ===========================================================================
test('healthz 200 döner', async () => {
  const res = await api('/healthz');
  assert.equal(res.status, 200);
});

test('bilinmeyen /api ucu 404 döner', async () => {
  const res = await api('/api/bu-yol-yok');
  assert.equal(res.status, 404);
});

test('bozuk JSON gövdesi temiz bir 400 döner (500 değil)', async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bozuk-json',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /JSON/);
});

// ===========================================================================
// ZİYARETÇİ: QR / ARAMA / ROTA
// ===========================================================================
test('geçersiz QR kodu 404 döner', async () => {
  const res = await api(`/api/qr/OLMAYAN-KOD?mall=${MALL}`);
  assert.equal(res.status, 404);
});

test('geçerli QR kodu başlangıç noktası döner', async () => {
  const res = await api(`/api/qr/K0-A-05?mall=${MALL}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.startNode.node_id);
});

test('boş arama sorgusu boş sonuç döner (hata değil)', async () => {
  const res = await api(`/api/search?q=&mall=${MALL}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.results, []);
});

test('AI arama doğal dil sorgusunu kategoriye eşler', async () => {
  const res = await api(`/api/search?${new URLSearchParams({ q: 'kahve içmek istiyorum', mall: MALL })}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.results.some((r) => r.name === 'Starbucks'), 'Starbucks sonuçlarda olmalı');
  assert.match(body.aiNote || '', /Yemek/);
});

test('AI arama: sözlükte olmayan sorgu LLM katmanına (mock modda) düşer ve gerçek mağaza bulur', async () => {
  // "müzik dinlemek istiyorum" INTENT_LEXICON'da YOK (sözlük hiçbir kategori
  // döndürmez) — bu test yalnızca AI_SEARCH_MOCK=true modunda (bkz. before()
  // hook'undaki spawn env) LLM katmanının devreye girip 'elektronik'
  // kategorisini yakaladığını doğrular.
  const res = await api(`/api/search?${new URLSearchParams({ q: 'müzik dinlemek istiyorum', mall: MALL })}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.results.some((r) => r.name === 'MediaMarkt'), 'MediaMarkt (elektronik) sonuçlarda olmalı');
  assert.match(body.aiNote || '', /Elektronik/);
});

test('AI arama: hiçbir katmanla eşleşmeyen sorgu 500 değil boş sonuç döner', async () => {
  const res = await api(`/api/search?${new URLSearchParams({ q: 'zzxxqqwwuygunolmayansorgu', mall: MALL })}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.results, []);
});

test('rota: from/to eksikse 400 döner', async () => {
  const res = await api(`/api/route?mall=${MALL}`);
  assert.equal(res.status, 400);
});

test('rota: geçersiz UUID formatında from/to 400 döner (500 değil)', async () => {
  const res = await api(`/api/route?from=abc&to=def&mall=${MALL}`);
  assert.equal(res.status, 400);
});

test('rota: geçersiz pref değeri 400 döner', async () => {
  const qrRes = await api(`/api/qr/K0-A-05?mall=${MALL}`).then((r) => r.json());
  const storesRes = await api(`/api/stores?mall=${MALL}`).then((r) => r.json());
  const zara = storesRes.stores.find((s) => s.slug === 'zara' || s.name === 'Zara');
  const res = await api(`/api/route?from=${qrRes.startNode.node_id}&to=${zara.id}&pref=ucus_kusu&mall=${MALL}`);
  assert.equal(res.status, 400);
});

test('rota: geçerli istekte sayısal mesafe döner (string-concat regresyonu)', async () => {
  const qrRes = await api(`/api/qr/K0-A-05?mall=${MALL}`).then((r) => r.json());
  const storesRes = await api(`/api/stores?mall=${MALL}`).then((r) => r.json());
  const target = storesRes.stores.find((s) => s.name === 'MediaMarkt') || storesRes.stores[0];
  const res = await api(`/api/route?from=${qrRes.startNode.node_id}&to=${target.id}&mall=${MALL}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.distance, 'number');
  assert.ok(!Number.isNaN(body.distance));
  assert.ok(Array.isArray(body.path) && body.path.length >= 2);
});

// ===========================================================================
// AUTH & RBAC
// ===========================================================================
test('yanlış şifreyle giriş 401 döner, kullanıcı var/yok bilgisini sızdırmaz', async () => {
  const wrongPass = await api('/api/auth/login', { method: 'POST', body: { email: 'admin@terrace-avm.com', password: 'yanlis' } });
  const noUser = await api('/api/auth/login', { method: 'POST', body: { email: 'olmayan@x.com', password: 'yanlis' } });
  assert.equal(wrongPass.status, 401);
  assert.equal(noUser.status, 401);
  const [b1, b2] = await Promise.all([wrongPass.json(), noUser.json()]);
  assert.equal(b1.error, b2.error, 'Aynı hata mesajı dönmeli (user enumeration önlemi)');
});

test('doğru giriş access+refresh token döner', async () => {
  const data = await loginAs('admin@terrace-avm.com', 'MallAdmin123!');
  assert.ok(data.accessToken);
  assert.ok(data.refreshToken);
  assert.equal(data.user.role, 'mall_admin');
});

test('token olmadan /api/auth/me 401 döner', async () => {
  const res = await api('/api/auth/me');
  assert.equal(res.status, 401);
});

test('geçerli token ile /api/auth/me 200 döner', async () => {
  const { accessToken } = await loginAs('admin@terrace-avm.com', 'MallAdmin123!');
  const res = await api('/api/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(res.status, 200);
});

test('RBAC: store_manager /api/admin/floors\'a erişemez (403)', async () => {
  const { accessToken } = await loginAs('lcwaikiki@terrace-avm.com', 'StoreManager123!');
  const res = await api('/api/admin/floors', { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(res.status, 403);
});

test('RBAC: mall_admin /api/store/me\'ye erişemez (403 — rol yanlış)', async () => {
  const { accessToken } = await loginAs('admin@terrace-avm.com', 'MallAdmin123!');
  const res = await api('/api/store/me', { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(res.status, 403);
});

test('RBAC: store_manager /api/superadmin/overview\'e erişemez (403)', async () => {
  const { accessToken } = await loginAs('lcwaikiki@terrace-avm.com', 'StoreManager123!');
  const res = await api('/api/superadmin/overview', { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(res.status, 403);
});

// ===========================================================================
// WEBHOOK TESLİMATI (Faz 10 — senkron yol; BullMQ/retry yolu REDIS_URL
// tanımlıyken devreye girer, bkz. services/webhookQueue.js. Bu paket
// varsayılan olarak REDIS_URL'siz koştuğundan burada senkron+tek-deneme
// yolu test edilir — asıl retry davranışı manuel olarak gerçek bir Redis'e
// karşı doğrulandı, bkz. README Faz 10 notu.)
// ===========================================================================
test('webhook: oluşturulan webhook, ilgili olay gerçekleştiğinde gerçekten çağrılır', async () => {
  const http = require('node:http');
  const { accessToken } = await loginAs('admin@terrace-avm.com', 'MallAdmin123!');

  let received = null;
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received = { headers: req.headers, body: JSON.parse(body) };
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((resolve) => receiver.listen(0, resolve));
  const port = receiver.address().port;

  const createRes = await api('/api/admin/webhooks', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
    body: { targetUrl: `http://127.0.0.1:${port}/hook`, events: ['store.created'] },
  });
  assert.equal(createRes.status, 201);
  const { webhook } = await createRes.json();
  assert.ok(webhook.secret, 'oluşturma yanıtında ham secret bir kereliğine görünmeli');

  const { rows: floorRows } = await require('../db/pool').pool.query(
    `SELECT id FROM floors WHERE mall_id = (SELECT id FROM malls WHERE slug='terrace') LIMIT 1`
  );
  const storeRes = await api('/api/admin/stores', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
    body: { name: 'Webhook Testi Mağaza', slug: `webhook-test-${Date.now()}`, floorId: floorRows[0].id },
  });
  assert.equal(storeRes.status, 201);

  // Senkron yolda teslimat, isteği bloklamadan arka planda (fire-and-forget)
  // gerçekleşir — kısa bir bekleme ile gerçekten çağrıldığını doğruluyoruz.
  await new Promise((resolve) => setTimeout(resolve, 500));
  receiver.close();

  assert.ok(received, 'webhook alıcısı gerçekten bir istek almalıydı');
  assert.equal(received.body.event, 'store.created');
  assert.ok(received.headers['x-smartway-signature'], 'HMAC imza header\'ı olmalı');

  const deliveriesRes = await api(`/api/admin/webhooks/${webhook.id}/deliveries`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const { deliveries } = await deliveriesRes.json();
  assert.ok(deliveries.some((d) => d.success === true), 'webhook_deliveries\'te başarılı bir kayıt olmalı');

  await api(`/api/admin/webhooks/${webhook.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
});

test('mall_admin kendi mağazasına scoped kalır (query param ile başka mall zorlanamaz)', async () => {
  const { accessToken } = await loginAs('admin@terrace-avm.com', 'MallAdmin123!');
  // Var olmayan bir mall slug'ı query'e eklense bile super_admin olmadığı için yok sayılır.
  const res = await api('/api/admin/floors?mall=olmayan-avm', { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(res.status, 200); // kendi mall'üne (terrace) scoped, hata vermez
  const body = await res.json();
  assert.ok(body.floors.length > 0);
});

// ===========================================================================
// REFRESH TOKEN ROTASYONU & PAROLA SIFIRLAMA (Faz 5 — Güvenlik Sertleştirme)
// ===========================================================================
test('refresh: geçerli token yeni bir access+refresh token çifti döner', async () => {
  const { refreshToken } = await freshLoginAs('admin@terrace-avm.com', 'MallAdmin123!');
  const res = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.accessToken);
  assert.ok(body.refreshToken, 'rotasyon: yanıt yeni bir refreshToken de içermeli');
  assert.notEqual(body.refreshToken, refreshToken, 'rotasyon: yeni refreshToken eskisiyle aynı olmamalı');
});

test('refresh: rotasyona uğramış (kullanılmış) bir token tekrar kullanılamaz', async () => {
  const { refreshToken } = await freshLoginAs('admin@terrace-avm.com', 'MallAdmin123!');
  const first = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken } });
  assert.equal(first.status, 200);
  // Aynı (artık eski) refreshToken ile tekrar deneniyor.
  const second = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken } });
  assert.equal(second.status, 401);
});

test('refresh: reuse tespiti sonrası rotasyondan doğan YENİ token de iptal edilmiş olur', async () => {
  const { refreshToken } = await freshLoginAs('admin@terrace-avm.com', 'MallAdmin123!');
  const first = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken } });
  const { refreshToken: rotatedToken } = await first.json();

  // Eski (zaten rotasyona uğramış) token'ı tekrar kullanmayı dene → reuse tespiti tetiklenir,
  // kullanıcının TÜM token'ları (rotatedToken dahil) iptal edilir.
  await api('/api/auth/refresh', { method: 'POST', body: { refreshToken } });

  const afterReuse = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: rotatedToken } });
  assert.equal(afterReuse.status, 401, 'reuse tespiti sonrası rotasyondan doğan token da geçersiz kılınmalı');
});

test('refresh: geçersiz/bilinmeyen token 401 döner', async () => {
  const res = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: 'olmayan-token' } });
  assert.equal(res.status, 401);
});

test('forgot-password: kayıtlı olsun olmasın her zaman aynı jenerik 200 yanıtı döner', async () => {
  const known = await api('/api/auth/forgot-password', { method: 'POST', body: { email: 'admin@terrace-avm.com' } });
  const unknown = await api('/api/auth/forgot-password', { method: 'POST', body: { email: 'olmayan-biri@x.com' } });
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  const [b1, b2] = await Promise.all([known.json(), unknown.json()]);
  assert.equal(b1.message, b2.message, 'enumeration önlemi: mesaj her durumda aynı olmalı');
});

test('forgot-password: e-posta eksikse 400 döner', async () => {
  const res = await api('/api/auth/forgot-password', { method: 'POST', body: {} });
  assert.equal(res.status, 400);
});

test('reset-password: geçersiz token 400 döner', async () => {
  const res = await api('/api/auth/reset-password', { method: 'POST', body: { token: 'olmayan-token', newPassword: 'YeniSifre123!' } });
  assert.equal(res.status, 400);
});

test('reset-password: zayıf yeni şifre 400 döner (geçerli bir token formatı ile bile)', async () => {
  const res = await api('/api/auth/reset-password', { method: 'POST', body: { token: 'herhangi-bir-token', newPassword: '123' } });
  assert.equal(res.status, 400);
});

// ===========================================================================
// ÖDEME / ABONELİK (Faz 6 — iyzico, IYZICO_MOCK modunda)
// ===========================================================================
test('billing: mall_admin kendi AVM\'sinin plan+fatura bilgisini görebilir', async () => {
  const { accessToken } = await loginAs('admin@terrace-avm.com', 'MallAdmin123!');
  const res = await api('/api/admin/billing', { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.subscription);
  assert.equal(body.subscription.plan_code, 'pro'); // seed.js'te Terrace AVM 'pro' planına atanmış
  assert.ok(Array.isArray(body.invoices));
});

test('billing: planlar listelenebilir', async () => {
  const { accessToken } = await loginAs('admin@terrace-avm.com', 'MallAdmin123!');
  const res = await api('/api/admin/billing/plans', { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.plans.find((p) => p.code === 'starter'));
  assert.ok(body.plans.find((p) => p.code === 'enterprise'));
});

test('billing: olmayan planId ile checkout 404 döner', async () => {
  const { accessToken } = await loginAs('admin@terrace-avm.com', 'MallAdmin123!');
  const res = await api('/api/admin/billing/checkout', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: { planId: '00000000-0000-0000-0000-000000000000' },
  });
  assert.equal(res.status, 404);
});

test('billing: checkout başlatma → mock callback → plan gerçekten yükseltilir', async () => {
  const { accessToken } = await loginAs('admin@terrace-avm.com', 'MallAdmin123!');
  const plansRes = await api('/api/admin/billing/plans', { headers: { Authorization: `Bearer ${accessToken}` } });
  const { plans } = await plansRes.json();
  const enterprise = plans.find((p) => p.code === 'enterprise');

  const checkoutRes = await api('/api/admin/billing/checkout', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: { planId: enterprise.id },
  });
  assert.equal(checkoutRes.status, 200);
  const { paymentPageUrl } = await checkoutRes.json();
  assert.ok(paymentPageUrl.includes('/api/billing/iyzico/callback'));

  // Kullanıcının tarayıcısının yapacağı yönlendirmeyi simüle eder (mock modda
  // gerçek bir kart formu olmadığından doğrudan callback URL'sine gidilir).
  const cbRes = await api(paymentPageUrl.replace(BASE, ''), { redirect: 'manual' });
  assert.equal(cbRes.status, 302);

  const billingRes = await api('/api/admin/billing', { headers: { Authorization: `Bearer ${accessToken}` } });
  const { subscription, invoices } = await billingRes.json();
  assert.equal(subscription.plan_code, 'enterprise');
  assert.ok(invoices.find((i) => i.status === 'paid' && i.plan_code === 'enterprise'));

  // Sonraki testleri etkilememesi için Terrace AVM'yi eski planına (pro) geri al.
  const { pool } = require('../db/pool');
  const proId = plans.find((p) => p.code === 'pro').id;
  await pool.query(`UPDATE malls SET plan_id = $1 WHERE slug = 'terrace'`, [proId]);
});

test('billing: geçersiz token ile callback güvenli şekilde başarısızlığa yönlendirir (500 değil)', async () => {
  const res = await api('/api/billing/iyzico/callback?token=olmayan-bir-token', { redirect: 'manual' });
  assert.equal(res.status, 302);
});

test('plan limiti: mağaza sayısı max_stores\'a ulaşınca yeni mağaza 402 ile engellenir', async () => {
  const { accessToken } = await loginAs('admin@terrace-avm.com', 'MallAdmin123!');
  const { pool } = require('../db/pool');

  // Terrace AVM'nin planını geçici olarak çok düşük bir mağaza limitine
  // sabitleyip test sonunda eski haline getiriyoruz (test izolasyonu).
  const { rows: mallRows } = await pool.query(`SELECT plan_id FROM malls WHERE slug = 'terrace'`);
  const originalPlanId = mallRows[0].plan_id;
  await pool.query(`UPDATE plans SET max_stores = 0 WHERE id = $1`, [originalPlanId]);

  try {
    const { rows: floorRows } = await pool.query(`SELECT id FROM floors WHERE mall_id = (SELECT id FROM malls WHERE slug='terrace') LIMIT 1`);
    const res = await api('/api/admin/stores', {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
      body: { name: 'Limit Testi Mağaza', slug: `limit-test-${Date.now()}`, floorId: floorRows[0].id },
    });
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.code, 'PLAN_LIMIT_REACHED');
  } finally {
    await pool.query(`UPDATE plans SET max_stores = 200 WHERE id = $1`, [originalPlanId]);
  }
});

test('plan özelliği: ai_search=false olan planda arama yalnızca doğrudan isim eşleşmesiyle çalışır (500 yok)', async () => {
  const { pool } = require('../db/pool');
  const { rows: mallRows } = await pool.query(`SELECT plan_id FROM malls WHERE slug = 'terrace'`);
  const originalPlanId = mallRows[0].plan_id;
  const { rows: starterRows } = await pool.query(`SELECT id FROM plans WHERE code = 'starter'`);

  await pool.query(`UPDATE malls SET plan_id = $1 WHERE slug = 'terrace'`, [starterRows[0].id]);
  try {
    const res = await api('/api/search?q=ayakkabi&mall=terrace'); // yanlış yazım — yalnızca AI intent çözümü yakalardı
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.results)); // 500 çökmesi yok, boş/az sonuç dönebilir — sorun değil
  } finally {
    await pool.query(`UPDATE malls SET plan_id = $1 WHERE slug = 'terrace'`, [originalPlanId]);
  }
});

// ===========================================================================
// SADAKAT / FAVORİLER — GİRİŞ DOĞRULAMA
// ===========================================================================
test('sadakat: geçersiz visitorId formatı 400 döner (500 değil)', async () => {
  const res = await api(`/api/loyalty/gecerli-olmayan-id?mall=${MALL}`);
  assert.equal(res.status, 400);
});

test('sadakat: geçersiz reason 400 döner', async () => {
  const res = await api(`/api/loyalty/earn?mall=${MALL}`, {
    method: 'POST', body: { visitorId: crypto.randomUUID(), reason: 'gecersiz_sebep' },
  });
  assert.equal(res.status, 400);
});

test('sadakat: prototype-pollution girişimi (reason=__proto__) 400 döner, 500 çökme yok', async () => {
  const res = await api(`/api/loyalty/earn?mall=${MALL}`, {
    method: 'POST', body: { visitorId: crypto.randomUUID(), reason: '__proto__' },
  });
  assert.equal(res.status, 400);
});

test('favoriler: başka bir AVM\'nin mağaza ID\'siyle favori eklenemez (404)', async () => {
  const visitorId = crypto.randomUUID();
  const fakeStoreId = crypto.randomUUID(); // rastgele, hiçbir mall'e ait değil
  const res = await api(`/api/favorites/toggle?mall=${MALL}`, {
    method: 'POST', body: { visitorId, storeId: fakeStoreId },
  });
  assert.equal(res.status, 404);
});

test('sadakat: tam akış — puan kazan, bakiye artar', async () => {
  const visitorId = crypto.randomUUID();
  await api(`/api/visitor/init?mall=${MALL}`, { method: 'POST', body: { visitorId } });
  const earnRes = await api(`/api/loyalty/earn?mall=${MALL}`, {
    method: 'POST', body: { visitorId, reason: 'route_complete' },
  });
  assert.equal(earnRes.status, 200);
  const earnBody = await earnRes.json();
  assert.equal(earnBody.earned, 5);
  assert.equal(earnBody.balance, 5);
});

// ===========================================================================
// KVKK — VERİ DIŞA AKTARMA / SİLME (Faz 9)
// ===========================================================================
test('privacy: veri dışa aktarma — sadakat+favori verisini doğru döner', async () => {
  const visitorId = crypto.randomUUID();
  await api(`/api/visitor/init?mall=${MALL}`, { method: 'POST', body: { visitorId } });
  await api(`/api/loyalty/earn?mall=${MALL}`, { method: 'POST', body: { visitorId, reason: 'qr_coupon' } });

  const storesRes = await api(`/api/stores?mall=${MALL}`);
  const { stores } = await storesRes.json();
  await api(`/api/favorites/toggle?mall=${MALL}`, { method: 'POST', body: { visitorId, storeId: stores[0].id } });

  const res = await api(`/api/privacy/${visitorId}/export?mall=${MALL}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.visitor.id, visitorId);
  assert.equal(body.loyalty.balance, 20);
  assert.equal(body.loyaltyTransactions.length, 1);
  assert.equal(body.favorites.length, 1);
  assert.equal(body.favorites[0].store_id, stores[0].id);
});

test('privacy: olmayan/geçersiz visitorId için 400/404 döner', async () => {
  const badFormat = await api(`/api/privacy/gecersiz-id/export?mall=${MALL}`);
  assert.equal(badFormat.status, 400);

  const notFound = await api(`/api/privacy/${crypto.randomUUID()}/export?mall=${MALL}`);
  assert.equal(notFound.status, 404);
});

test('privacy: başka bir AVM\'nin ziyaretçi verisine erişilemez (tenant izolasyonu)', async () => {
  const { pool } = require('../db/pool');
  const visitorId = crypto.randomUUID();
  await api(`/api/visitor/init?mall=${MALL}`, { method: 'POST', body: { visitorId } });

  // Gerçek, farklı bir AVM oluşturup o AVM'nin bağlamından erişmeyi dene.
  const { rows: planRows } = await pool.query(`SELECT id FROM plans LIMIT 1`);
  await pool.query(
    `INSERT INTO malls (slug, name, city, plan_id, status) VALUES ('privacy-test-mall','Privacy Test AVM','İstanbul',$1,'active') ON CONFLICT (slug) DO NOTHING`,
    [planRows[0].id]
  );

  const res = await api(`/api/privacy/${visitorId}/export?mall=privacy-test-mall`);
  assert.equal(res.status, 404);

  await pool.query(`DELETE FROM malls WHERE slug = 'privacy-test-mall'`);
});

test('privacy: veri silme — gerçekten siler, sonraki erişim 404 döner', async () => {
  const visitorId = crypto.randomUUID();
  await api(`/api/visitor/init?mall=${MALL}`, { method: 'POST', body: { visitorId } });
  await api(`/api/loyalty/earn?mall=${MALL}`, { method: 'POST', body: { visitorId, reason: 'qr_coupon' } });

  const delRes = await api(`/api/privacy/${visitorId}?mall=${MALL}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);

  const afterRes = await api(`/api/privacy/${visitorId}/export?mall=${MALL}`);
  assert.equal(afterRes.status, 404);

  const { pool } = require('../db/pool');
  const { rows } = await pool.query('SELECT 1 FROM loyalty_points WHERE visitor_id = $1', [visitorId]);
  assert.equal(rows.length, 0, 'loyalty_points CASCADE ile silinmiş olmalı');
});

test('privacy: çekilişte kazanan olan bir ziyaretçi bile FK hatası vermeden silinebilir', async () => {
  const { pool } = require('../db/pool');
  const visitorId = crypto.randomUUID();
  await api(`/api/visitor/init?mall=${MALL}`, { method: 'POST', body: { visitorId } });

  const { rows: mallRows } = await pool.query(`SELECT id FROM malls WHERE slug = $1`, [MALL]);
  const { rows: raffleRows } = await pool.query(
    `INSERT INTO raffles (mall_id, title, starts_at, ends_at) VALUES ($1,'Test Çekilişi (otomatik test)', now() - interval '1 day', now() + interval '1 day') RETURNING id`,
    [mallRows[0].id]
  );
  await pool.query(`UPDATE raffles SET winner_visitor_id = $1 WHERE id = $2`, [visitorId, raffleRows[0].id]);

  const delRes = await api(`/api/privacy/${visitorId}?mall=${MALL}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);

  const { rows: check } = await pool.query('SELECT winner_visitor_id FROM raffles WHERE id = $1', [raffleRows[0].id]);
  assert.equal(check[0].winner_visitor_id, null);

  await pool.query('DELETE FROM raffles WHERE id = $1', [raffleRows[0].id]);
});

test('reklam tıklama: geçersiz UUID 400, başka mall\'ün reklamı 404 döner', async () => {
  const badRes = await api(`/api/ads/gecersiz-id/click?mall=${MALL}`, { method: 'POST', body: {} });
  assert.equal(badRes.status, 400);

  const fakeAdRes = await api(`/api/ads/${crypto.randomUUID()}/click?mall=${MALL}`, { method: 'POST', body: {} });
  assert.equal(fakeAdRes.status, 404);
});

// ===========================================================================
// API ANAHTARI / ÜÇÜNCÜ PARTİ API
// ===========================================================================
test('public API: X-API-Key olmadan 401 döner', async () => {
  const res = await api('/api/public/v1/stores');
  assert.equal(res.status, 401);
});

test('public API: geçersiz anahtar 401 döner', async () => {
  const res = await api('/api/public/v1/stores', { headers: { 'X-API-Key': 'sw_live_gecersiz' } });
  assert.equal(res.status, 401);
});

test('API anahtarı yaşam döngüsü: oluştur → kullan → iptal et → engellenir', async () => {
  const { accessToken } = await loginAs('admin@terrace-avm.com', 'MallAdmin123!');
  const createRes = await api('/api/admin/api-keys', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: { label: 'Test Anahtarı' },
  });
  assert.equal(createRes.status, 201);
  const { rawKey, apiKey } = await createRes.json();

  const useRes = await api('/api/public/v1/stores', { headers: { 'X-API-Key': rawKey } });
  assert.equal(useRes.status, 200);

  const revokeRes = await api(`/api/admin/api-keys/${apiKey.id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` },
  });
  assert.equal(revokeRes.status, 200);

  const blockedRes = await api('/api/public/v1/stores', { headers: { 'X-API-Key': rawKey } });
  assert.equal(blockedRes.status, 401);
});

// ===========================================================================
// YİNELENEN ANAHTAR → 409 (500 DEĞİL)
// ===========================================================================
test('aynı slug ile ikinci mağaza oluşturma 409 döner', async () => {
  const { accessToken } = await loginAs('admin@terrace-avm.com', 'MallAdmin123!');
  const floorsRes = await api('/api/admin/floors', { headers: { Authorization: `Bearer ${accessToken}` } }).then((r) => r.json());
  const floorId = floorsRes.floors[0].id;

  const first = await api('/api/admin/stores', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
    body: { name: 'Tekrar Testi', slug: `tekrar-test-${Date.now()}`, floorId },
  });
  assert.equal(first.status, 201);
  const { store } = await first.json();

  const second = await api('/api/admin/stores', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
    body: { name: 'Tekrar Testi 2', slug: store.slug, floorId },
  });
  assert.equal(second.status, 409);
});

test('zayıf şifreyle kullanıcı davet etme 400 döner', async () => {
  const { accessToken } = await loginAs('admin@terrace-avm.com', 'MallAdmin123!');
  const res = await api('/api/admin/users', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
    body: { email: `test-${Date.now()}@x.com`, password: '123', fullName: 'Test', role: 'mall_admin' },
  });
  assert.equal(res.status, 400);
});

// ===========================================================================
// SIGNAGE / KIOSK
// ===========================================================================
test('kiosk: olmayan eşleştirme kodu 404 döner', async () => {
  const res = await api('/api/signage/OLMAYAN/playlist');
  assert.equal(res.status, 404);
});

// ===========================================================================
// ROUTE ENGINE — SAF BİRİM TESTİ (HTTP olmadan, doğrudan modül)
// ===========================================================================
test('route engine: erişilebilir tercih merdiveni tamamen eler', () => {
  const { NavGraph } = require('../services/routeEngine');
  const nodes = [
    { id: 'a', floorId: 'f0', x: 0, y: 0, accessible: true },
    { id: 'b', floorId: 'f0', x: 10, y: 0, accessible: true },
    { id: 'c', floorId: 'f0', x: 20, y: 0, accessible: true },
  ];
  const edges = [
    { fromId: 'a', toId: 'b', weight: 1, edgeType: 'stairs' },
    { fromId: 'b', toId: 'c', weight: 1, edgeType: 'walk' },
  ];
  const graph = new NavGraph(nodes, edges);
  const result = graph.findPath('a', 'c', 'accessible');
  assert.equal(result, null, 'Merdivenden başka yol yoksa erişilebilir rota bulunmamalı');

  const shortest = graph.findPath('a', 'c', 'shortest');
  assert.ok(shortest, 'shortest tercihinde merdiven kullanılarak rota bulunmalı');
});

test('route engine: NUMERIC string girişte bile doğru sayısal mesafe üretir', () => {
  const { NavGraph } = require('../services/routeEngine');
  // pg sürücüsünün NUMERIC alanları string döndürme senaryosunu simüle eder.
  const nodes = [
    { id: 'a', floorId: 'f0', x: '0', y: '0', accessible: true },
    { id: 'b', floorId: 'f0', x: '10', y: '0', accessible: true },
  ];
  const edges = [{ fromId: 'a', toId: 'b', weight: '5', edgeType: 'elevator' }];
  const graph = new NavGraph(nodes, edges);
  const result = graph.findPath('a', 'b', 'shortest');
  assert.equal(typeof result.distance, 'number');
  assert.equal(result.distance, 13); // 5 (weight) + 8 (elevator cezası)
});
