// frontend/public/service-worker.js
//
// Strateji:
//  - App shell (HTML/CSS/JS/manifest/ikonlar): cache-first, hızlı açılış.
//  - /api/* GET istekleri (kat verisi, mağaza listesi vb.): stale-while-revalidate
//    → önce cache'ten hemen yanıt ver, arka planda ağdan güncelle.
//  - Rota hesaplaması zaten tamamen istemci tarafında (routeEngine.js) çalıştığı
//    için internet olmasa da en son senkronize edilen node/edge/mağaza verisiyle
//    QR okutma → rota alma akışı çalışmaya devam eder.

const SHELL_CACHE = 'smartway-shell-v1';
const DATA_CACHE = 'smartway-data-v1';

const SHELL_ASSETS = [
  '/', '/index.html', '/manifest.json',
  '/css/style.css',
  '/js/app.js', '/js/map.js', '/js/routeEngine.js',
  '/icons/icon-192.svg', '/icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL_CACHE, DATA_CACHE].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Temiz AVM URL'leri (örn. /iyasparkavm) da app-shell (index.html) ile
  // aynı şekilde önbelleklenir — tek segmentli, dosya olmayan herhangi bir
  // path bir AVM slug'ı olabilir (bkz. backend/server.js'teki eşleşen route).
  const isMallSlugPath = /^\/[^/.]+$/.test(url.pathname) && url.pathname !== '/api';
  if (SHELL_ASSETS.some((a) => url.pathname === a) || url.pathname === '/' || isMallSlugPath) {
    event.respondWith(cacheFirst(request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, res.clone());
    return res;
  } catch {
    return caches.match('/index.html');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((res) => { if (res.ok) cache.put(request, res.clone()); return res; })
    .catch(() => null);
  return cached || (await networkPromise) || new Response(JSON.stringify({ error: 'Çevrimdışı ve önbellek boş.' }), {
    status: 503, headers: { 'Content-Type': 'application/json' },
  });
}
