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
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
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

test('mall_admin kendi mağazasına scoped kalır (query param ile başka mall zorlanamaz)', async () => {
  const { accessToken } = await loginAs('admin@terrace-avm.com', 'MallAdmin123!');
  // Var olmayan bir mall slug'ı query'e eklense bile super_admin olmadığı için yok sayılır.
  const res = await api('/api/admin/floors?mall=olmayan-avm', { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal(res.status, 200); // kendi mall'üne (terrace) scoped, hata vermez
  const body = await res.json();
  assert.ok(body.floors.length > 0);
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
// ÇAPRAZ-TENANT REKLAM TIKLAMA KORUMASI
// ===========================================================================
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
