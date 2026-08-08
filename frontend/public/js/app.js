// frontend/public/js/app.js
'use strict';

const API_BASE = '/api';
const MALL_SLUG = new URLSearchParams(location.search).get('mall') || 'terrace';

// ---------------------------------------------------------------------
// ZİYARETÇİ KİMLİĞİ (anonim, cihazda kalıcı — sadakat/favoriler/çekiliş için)
// ---------------------------------------------------------------------
function getVisitorId() {
  let id = localStorage.getItem('sw_visitor_id');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'v-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    localStorage.setItem('sw_visitor_id', id);
  }
  return id;
}

// ---------------------------------------------------------------------
// ÇOKLU DİL (basit i18n — çekirdek arayüz metinleri)
// ---------------------------------------------------------------------
const I18N = {
  tr: {
    searchPlaceholder: 'Mağaza ara, ya da ‘kahve içmek istiyorum’ yazın…',
    locating: 'Konum belirleniyor…',
    goToStore: 'Bu Mağazaya Git →',
    routeTitle: 'Rota',
  },
  en: {
    searchPlaceholder: 'Search a store, or type “I want coffee”…',
    locating: 'Locating…',
    goToStore: 'Get Directions →',
    routeTitle: 'Route',
  },
};
function getLocale() { return localStorage.getItem('sw_locale') || 'tr'; }
function t(key) { return I18N[getLocale()][key] || I18N.tr[key]; }
function applyLocale() {
  document.getElementById('searchInput').placeholder = t('searchPlaceholder');
  document.getElementById('langBtn').textContent = getLocale().toUpperCase();
}
document.getElementById('langBtn')?.addEventListener('click', () => {
  localStorage.setItem('sw_locale', getLocale() === 'tr' ? 'en' : 'tr');
  applyLocale();
});

const state = {
  startNode: null,     // { node_id, floor_id, x, y, level_index }
  floors: [],           // [{id, level_index, label, viewbox, nodes, edges, stores}]
  activeFloorId: null,
  categories: [],
  activeCategory: null,
  routePreference: 'shortest',
  activeRouteTargetStoreId: null,
  activeStoreSlug: null,
  sessionId: null,
  visitorId: getVisitorId(),
  loyaltyBalance: 0,
  favoriteStoreIds: new Set(),
};

function api(path, opts) {
  const sep = path.includes('?') ? '&' : '?';
  return fetch(`${API_BASE}${path}${sep}mall=${MALL_SLUG}`, opts)
    .then(async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `İstek başarısız (${r.status})`);
      }
      return r.json();
    });
}

// ---------------------------------------------------------------------
// QR OKUTMA SİMÜLASYONU
// ---------------------------------------------------------------------
const DEMO_QR_CODES = [
  { code: 'K0-A-05', label: 'Zemin Kat · Koridor A' },
];

function initQrOverlay() {
  const grid = document.getElementById('qrDemoGrid');
  DEMO_QR_CODES.forEach((qr, i) => {
    const btn = document.createElement('button');
    btn.className = 'qr-demo-chip' + (i === 0 ? ' active' : '');
    btn.innerHTML = `<span class="qr-demo-chip__code">${qr.code}</span><span class="qr-demo-chip__label">${qr.label}</span>`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.qr-demo-chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      btn.dataset.selected = 'true';
    });
    if (i === 0) btn.dataset.selected = 'true';
    grid.appendChild(btn);
  });

  document.getElementById('qrScanBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.classList.contains('scanning')) return;
    btn.classList.add('scanning');
    btn.lastChild.textContent = ' Okutuluyor…';
    const selected = document.querySelector('.qr-demo-chip.active .qr-demo-chip__code').textContent;
    await new Promise((res) => setTimeout(res, 900));
    try {
      await handleQrScanned(selected);
      document.getElementById('qrOverlay').setAttribute('hidden', '');
      document.getElementById('app').removeAttribute('hidden');
      applyLocale();
    } catch (err) {
      alert('QR okunamadı: ' + err.message);
      btn.classList.remove('scanning');
    }
  });
}

async function handleQrScanned(code) {
  const { startNode } = await api(`/qr/${encodeURIComponent(code)}`);
  state.startNode = startNode;
  document.getElementById('currentLocLabel').textContent = `📍 ${startNode.floor_label} · ${code}`;

  // Oturum başlat (davranışsal reklam hedeflemesi + analitik için)
  api('/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryQrCode: code, locale: getLocale() }) })
    .then((r) => { state.sessionId = r.sessionId; }).catch(() => {});

  // Ziyaretçi kimliğini başlat (sadakat puanı + favoriler — anonim, cihaz bazlı)
  api('/visitor/init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: state.visitorId }) })
    .then((r) => {
      state.loyaltyBalance = r.balance;
      state.favoriteStoreIds = new Set(r.favoriteStoreIds);
      renderLoyaltyBadge();
    }).catch(() => {});

  await bootstrapMall();
}

function renderLoyaltyBadge() {
  let badge = document.getElementById('loyaltyBadge');
  if (!badge) {
    badge = document.createElement('button');
    badge.id = 'loyaltyBadge';
    badge.className = 'icon-btn';
    badge.title = 'Puanlarım';
    badge.style.width = 'auto';
    badge.style.padding = '0 12px';
    badge.style.fontSize = '13px';
    badge.style.fontWeight = '700';
    badge.addEventListener('click', showRaffles);
    document.querySelector('.topbar__actions').prepend(badge);
  }
  badge.textContent = `✦ ${state.loyaltyBalance}`;
}

async function showRaffles() {
  try {
    const { raffles } = await api('/raffles/active');
    if (!raffles.length) { alert('Şu anda aktif çekiliş yok.'); return; }
    const r = raffles[0];
    const cost = r.entry_cost_points > 0 ? `${r.entry_cost_points} puan karşılığında` : 'ücretsiz';
    if (!confirm(`${r.title}\nÖdül: ${r.prize_label || '—'}\n${cost} katılabilirsiniz. Katılmak ister misiniz?`)) return;
    const res = await api(`/raffles/${r.id}/enter`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: state.visitorId }),
    });
    if (res.entered) {
      state.loyaltyBalance -= r.entry_cost_points;
      renderLoyaltyBadge();
      alert('Çekilişe katıldınız! Bol şans 🍀');
    }
  } catch (err) { alert(err.message); }
}

// ---------------------------------------------------------------------
// AVM VERİSİ YÜKLEME
// ---------------------------------------------------------------------
async function bootstrapMall() {
  document.getElementById('mallName').textContent = 'Terrace AVM';

  const [{ categories }, { stores }, { popup }] = await Promise.all([
    api('/categories'),
    api('/stores'),
    api('/popups/active'),
  ]);
  state.categories = categories;
  renderCategoryChips();

  // Basit demo: tek kat grubu (Zemin Kat) — gerçek ortamda /api/floors ile çekilir.
  await loadFloorGeometry(stores);
  renderFloorTabs();
  renderActiveFloor();

  if (popup) showMallPopup(popup);
  loadHomeAd();
}

async function loadFloorGeometry(stores) {
  // Demo: sunucudaki seed verisiyle örtüşen sabit iki katlı graf (üretimde /api/floors/:id/graph gibi bir uçtan çekilir)
  // Basitlik için burada backend seed'inde kullanılan node koordinatlarının bir kopyasını tutuyoruz.
  const groundNodes = [
    { id: 'K0-A-05', floorId: 'f0', code: 'K0-A-05', type: 'corridor', x: 80, y: 300, accessible: true },
    { id: 'K0-C1', floorId: 'f0', code: 'K0-C1', type: 'corridor', x: 250, y: 300, accessible: true },
    { id: 'K0-C2', floorId: 'f0', code: 'K0-C2', type: 'corridor', x: 450, y: 300, accessible: true },
    { id: 'K0-C3', floorId: 'f0', code: 'K0-C3', type: 'corridor', x: 650, y: 300, accessible: true },
    { id: 'K0-ELV', floorId: 'f0', code: 'K0-ELV', type: 'elevator', x: 650, y: 150, accessible: true },
    { id: 'K0-STORE-LCW', floorId: 'f0', code: 'K0-STORE-LCW', type: 'store_entrance', x: 450, y: 200, accessible: true },
    { id: 'K0-STORE-ZARA', floorId: 'f0', code: 'K0-STORE-ZARA', type: 'store_entrance', x: 650, y: 450, accessible: true },
    { id: 'K0-STORE-STARBUCKS', floorId: 'f0', code: 'K0-STORE-STARBUCKS', type: 'store_entrance', x: 250, y: 450, accessible: true },
  ];
  const floor1Nodes = [
    { id: 'K1-ELV', floorId: 'f1', code: 'K1-ELV', type: 'elevator', x: 650, y: 150, accessible: true },
    { id: 'K1-C1', floorId: 'f1', code: 'K1-C1', type: 'corridor', x: 650, y: 300, accessible: true },
    { id: 'K1-C2', floorId: 'f1', code: 'K1-C2', type: 'corridor', x: 450, y: 300, accessible: true },
    { id: 'K1-STORE-MEDIAMARKT', floorId: 'f1', code: 'K1-STORE-MEDIAMARKT', type: 'store_entrance', x: 450, y: 200, accessible: true },
    { id: 'K1-STORE-MANGO', floorId: 'f1', code: 'K1-STORE-MANGO', type: 'store_entrance', x: 250, y: 300, accessible: true },
  ];
  const edges = [
    ['K0-A-05','K0-C1',1],['K0-C1','K0-C2',1],['K0-C2','K0-C3',1],
    ['K0-C2','K0-STORE-LCW',1],['K0-C1','K0-STORE-STARBUCKS',1],
    ['K0-C3','K0-STORE-ZARA',1],['K0-C3','K0-ELV',1],
    ['K0-ELV','K1-ELV',4,'elevator'],
    ['K1-ELV','K1-C1',1],['K1-C1','K1-C2',1],
    ['K1-C2','K1-STORE-MEDIAMARKT',1],['K1-C2','K1-STORE-MANGO',1],
  ].map(([fromId, toId, weight, edgeType]) => ({ fromId, toId, weight, edgeType: edgeType || 'walk', bidirectional: true }));

  const storesByFloor = { f0: [], f1: [] };
  for (const s of stores) {
    const floorKey = s.level_index === 1 ? 'f1' : 'f0';
    const node = [...groundNodes, ...floor1Nodes].find((n) => n.code === codeForStore(s));
    storesByFloor[floorKey].push({ ...s, entrance_node_id: node ? node.id : null });
  }

  state.floors = [
    { id: 'f0', level_index: 0, label: 'Zemin Kat', viewbox: [0,0,1000,600], nodes: groundNodes, stores: storesByFloor.f0 },
    { id: 'f1', level_index: 1, label: '1. Kat', viewbox: [0,0,1000,600], nodes: floor1Nodes, stores: storesByFloor.f1 },
  ];
  state.allEdges = edges;
  state.allNodes = [...groundNodes, ...floor1Nodes];
  state.activeFloorId = state.startNode?.level_index === 1 ? 'f1' : 'f0';
}

function codeForStore(store) {
  const map = {
    'lc-waikiki': 'K0-STORE-LCW', zara: 'K0-STORE-ZARA', starbucks: 'K0-STORE-STARBUCKS',
    mediamarkt: 'K1-STORE-MEDIAMARKT', mango: 'K1-STORE-MANGO',
  };
  return map[store.slug];
}

// ---------------------------------------------------------------------
// KATEGORİ + KAT SEKMELERİ
// ---------------------------------------------------------------------
function renderCategoryChips() {
  const wrap = document.getElementById('categoryScroll');
  wrap.innerHTML = '';
  state.categories.forEach((cat) => {
    const chip = document.createElement('button');
    chip.className = 'cat-chip';
    chip.textContent = cat.name_tr;
    chip.addEventListener('click', () => {
      state.activeCategory = state.activeCategory === cat.code ? null : cat.code;
      document.querySelectorAll('.cat-chip').forEach((c) => c.classList.remove('active'));
      if (state.activeCategory) chip.classList.add('active');
      renderActiveFloor();
    });
    wrap.appendChild(chip);
  });
}

function renderFloorTabs() {
  const wrap = document.getElementById('floorTabs');
  wrap.innerHTML = '';
  state.floors.forEach((f) => {
    const tab = document.createElement('button');
    tab.className = 'floor-tab' + (f.id === state.activeFloorId ? ' active' : '');
    tab.textContent = f.label;
    tab.addEventListener('click', () => {
      state.activeFloorId = f.id;
      document.querySelectorAll('.floor-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      renderActiveFloor();
    });
    wrap.appendChild(tab);
  });
}

function renderActiveFloor() {
  const floor = state.floors.find((f) => f.id === state.activeFloorId);
  if (!floor) return;
  const visibleStores = state.activeCategory
    ? floor.stores.filter((s) => true) // demo: kategori-mağaza eşlemesi backend'de zaten filtrelenebilir; burada tümünü göster
    : floor.stores;

  const startsOnThisFloor = state.startNode && floor.level_index === state.startNode.level_index;
  SmartWayMap.render({
    viewBox: floor.viewbox,
    stores: visibleStores,
    nodes: floor.nodes,
    edges: state.allEdges,
    startNodeId: startsOnThisFloor ? state.startNode.node_id : null,
  });
  SmartWayMap.onStoreClick(openStoreModal);
}

// ---------------------------------------------------------------------
// ARAMA
// ---------------------------------------------------------------------
let searchDebounce;
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('searchInput');
  input.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = input.value.trim();
    if (!q) { document.getElementById('resultsPanel').hidden = true; return; }
    searchDebounce = setTimeout(() => runSearch(q), 220);
  });
  input.addEventListener('focus', () => { if (input.value.trim()) document.getElementById('resultsPanel').hidden = false; });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-zone')) document.getElementById('resultsPanel').hidden = true;
  });
});

async function runSearch(q) {
  const panel = document.getElementById('resultsPanel');
  try {
    const sidParam = state.sessionId ? `&sessionId=${state.sessionId}` : '';
    const { results, aiNote } = await api(`/search?q=${encodeURIComponent(q)}${sidParam}`);
    panel.hidden = false;
    if (!results.length) {
      panel.innerHTML = `<div class="results-empty">“${escapeHtml(q)}” için sonuç bulunamadı.</div>`;
      return;
    }
    panel.innerHTML = aiNote ? `<div class="results-empty" style="text-align:left;border-bottom:1px solid var(--line)">🤖 ${escapeHtml(aiNote)}</div>` : '';
    results.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'result-row';
      row.innerHTML = `
        <div class="result-row__avatar">${r.name.charAt(0)}</div>
        <div style="flex:1">
          <p class="result-row__name">${escapeHtml(r.name)}</p>
          <p class="result-row__floor">${escapeHtml(r.floor_label)}</p>
        </div>
        ${r.has_campaign ? '<span class="result-row__badge">Kampanya</span>' : ''}
      `;
      row.addEventListener('click', () => { panel.hidden = true; document.getElementById('searchInput').value = ''; openStoreModal(r.id); });
      panel.appendChild(row);
    });
  } catch (err) {
    panel.hidden = false;
    panel.innerHTML = `<div class="results-empty">${escapeHtml(err.message)}</div>`;
  }
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ---------------------------------------------------------------------
// MAĞAZA DETAY MODAL
// ---------------------------------------------------------------------
async function openStoreModal(storeId) {
  const floor = state.floors.flatMap((f) => f.stores).find((s) => s.id === storeId);
  if (!floor) return;
  try {
    const { store, campaigns } = await api(`/stores/${floor.slug}`);
    state.activeStoreSlug = store.slug;
    document.getElementById('storeName').textContent = store.name;
    document.getElementById('storeFloorLabel').textContent = `${store.floor_label} · ${store.unit_no || ''}`;
    document.getElementById('storeLogo').src = store.logo_url || placeholderLogo(store.name);
    document.getElementById('storeDescription').textContent = store.description || 'Mağaza açıklaması yakında eklenecek.';

    const meta = document.getElementById('storeMeta');
    meta.innerHTML = '';
    if (store.phone) meta.innerHTML += `<span class="store-meta__pill">📞 ${store.phone}</span>`;
    meta.innerHTML += `<span class="store-meta__pill">🕙 10:00 – 22:00</span>`;

    const campWrap = document.getElementById('storeCampaigns');
    campWrap.innerHTML = campaigns.map((c) => `
      <div class="campaign-card">
        <span class="campaign-card__badge">${badgeLabel(c.badge)}</span>
        <h4>${escapeHtml(c.title)}</h4>
        ${c.discount_percent ? `<p>%${c.discount_percent} indirim</p>` : ''}
        ${c.coupon_code ? `<span class="campaign-card__coupon">${escapeHtml(c.coupon_code)}</span>` : ''}
      </div>`).join('');

    document.getElementById('storeRouteBtn').onclick = () => { closeStoreModal(); startRouteTo(store.id, store.name); };
    renderFavoriteButton(store.id);
    document.getElementById('storeModal').hidden = false;
  } catch (err) {
    alert(err.message);
  }
}

function renderFavoriteButton(storeId) {
  let favBtn = document.getElementById('favBtn');
  if (!favBtn) {
    favBtn = document.createElement('button');
    favBtn.id = 'favBtn';
    favBtn.className = 'icon-btn';
    favBtn.style.position = 'absolute';
    favBtn.style.top = '14px';
    favBtn.style.left = '14px';
    document.querySelector('.store-modal__cover').appendChild(favBtn);
  }
  const isFav = state.favoriteStoreIds.has(storeId);
  favBtn.textContent = isFav ? '♥' : '♡';
  favBtn.style.color = isFav ? '#B5652C' : '#fff';
  favBtn.onclick = async () => {
    try {
      const r = await api('/favorites/toggle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: state.visitorId, storeId }),
      });
      if (r.favorited) state.favoriteStoreIds.add(storeId); else state.favoriteStoreIds.delete(storeId);
      renderFavoriteButton(storeId);
    } catch (err) { alert(err.message); }
  };
}
function badgeLabel(b) { return ({ indirim: '% İndirim', yeni: 'Yeni', hediye: 'Hediye' })[b] || 'Kampanya'; }
function placeholderLogo(name) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="%2317140F"/><text x="40" y="48" font-size="30" fill="%23C79A3E" text-anchor="middle" font-family="Georgia">${name.charAt(0)}</text></svg>`;
  return `data:image/svg+xml,${svg}`;
}
function closeStoreModal() { document.getElementById('storeModal').hidden = true; }
document.getElementById('storeModalClose')?.addEventListener('click', closeStoreModal);
document.getElementById('storeModalScrim')?.addEventListener('click', closeStoreModal);

// ---------------------------------------------------------------------
// ROTA HESAPLAMA (istemci tarafı NavGraph — offline dahi çalışır)
// ---------------------------------------------------------------------
async function startRouteTo(storeId, storeName) {
  state.activeRouteTargetStoreId = storeId;
  computeAndShowRoute();
}

function computeAndShowRoute() {
  if (!state.startNode || !state.activeRouteTargetStoreId) return;
  const { NavGraph } = window.SmartWayRouteEngine;
  const graph = new NavGraph(state.allNodes, state.allEdges);
  const targetStore = state.floors.flatMap((f) => f.stores).find((s) => s.id === state.activeRouteTargetStoreId);
  if (!targetStore || !targetStore.entrance_node_id) { alert('Bu mağaza için rota hesaplanamadı.'); return; }

  const result = graph.findPath(state.startNode.node_id, targetStore.entrance_node_id, state.routePreference);
  if (!result) { alert('Rota bulunamadı.'); return; }

  const instructions = graph.toInstructions(result.path);
  renderRouteSheet(targetStore.name, instructions);

  // Aktif katı, rotanın başladığı kata çevir, sonra çizim yap
  const startFloorId = state.allNodes.find((n) => n.id === state.startNode.node_id)?.floorId || state.activeFloorId;
  state.activeFloorId = startFloorId;
  document.querySelectorAll('.floor-tab').forEach((t, i) => t.classList.toggle('active', state.floors[i]?.id === startFloorId));
  renderActiveFloor();

  const floorChangeIdx = result.path.findIndex((id, i) => i > 0 && state.allNodes.find(n=>n.id===id).floorId !== state.allNodes.find(n=>n.id===state.startNode.node_id).floorId);
  const segment = floorChangeIdx === -1 ? result.path : result.path.slice(0, floorChangeIdx + 1);
  const nodesById = new Map(state.allNodes.map((n) => [n.id, n]));
  SmartWayMap.drawRoute(segment.map((id) => nodesById.get(id)));

  document.getElementById('routeSheet').hidden = false;

  // Sadakat puanı: rota tamamlandığında (Bölüm 9 — puan sistemi)
  if (!state._earnedRouteFor || state._earnedRouteFor !== targetStore.id) {
    state._earnedRouteFor = targetStore.id;
    api('/loyalty/earn', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: state.visitorId, reason: 'route_complete', referenceId: targetStore.id }),
    }).then((r) => { state.loyaltyBalance = r.balance; renderLoyaltyBadge(); }).catch(() => {});
  }
}

function renderRouteSheet(storeName, instructions) {
  document.getElementById('routeStoreName').textContent = storeName;
  const list = document.getElementById('routeSteps');
  list.innerHTML = '';
  instructions.forEach((step, i) => {
    const row = document.createElement('div');
    row.className = 'route-step';
    row.innerHTML = `<div class="route-step__dot">${glyphFor(step.type, i, instructions.length)}</div><div class="route-step__label">${step.label}</div>`;
    list.appendChild(row);
  });

  // Rota tamamlandı reklam alanı (kategori hedeflemeli)
  loadRouteAd();
}
function glyphFor(type, i, total) {
  if (type === 'start') return '●';
  if (type === 'arrive') return '🏁';
  if (type === 'floor_change') return '⬍';
  if (type.includes('Sağ') || type === 'turn') return '↱';
  return i + 1;
}

document.querySelectorAll('.chip[data-pref]').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip[data-pref]').forEach((c) => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');
    state.routePreference = chip.dataset.pref;
    computeAndShowRoute();
  });
});
document.getElementById('routeClose')?.addEventListener('click', () => {
  document.getElementById('routeSheet').hidden = true;
  SmartWayMap.clearRoute();
  state.activeRouteTargetStoreId = null;
});

// ---------------------------------------------------------------------
// REKLAM & AVM POPUP
// ---------------------------------------------------------------------
async function loadHomeAd() {
  try {
    const sidParam = state.sessionId ? `&sessionId=${state.sessionId}` : '';
    const { ad } = await api(`/ads?slot=home_top${sidParam}`);
    const slot = document.getElementById('homeAd');
    if (!ad) { slot.hidden = true; return; }
    slot.hidden = false;
    slot.innerHTML = renderAdCreative(ad);
    slot.querySelector('[data-ad-click]')?.addEventListener('click', () => registerAdClick(ad.id, ad.click_url));
  } catch { /* sessizce geç */ }
}
async function loadRouteAd() {
  try {
    const sidParam = state.sessionId ? `&sessionId=${state.sessionId}` : '';
    const { ad } = await api(`/ads?slot=route_complete${sidParam}`);
    const slot = document.getElementById('routeCompleteAd');
    if (!ad) { slot.hidden = true; return; }
    slot.hidden = false;
    slot.innerHTML = renderAdCreative(ad);
    slot.querySelector('[data-ad-click]')?.addEventListener('click', () => registerAdClick(ad.id, ad.click_url));
  } catch { /* sessizce geç */ }
}
function renderAdCreative(ad) {
  const media = ad.creative_type === 'video'
    ? `<video src="${ad.creative_url}" autoplay muted loop playsinline></video>`
    : `<img src="${ad.creative_url}" alt="Reklam" />`;
  return `<a href="#" data-ad-click style="display:block">${media}</a>`;
}
function registerAdClick(adId, url) {
  api(`/ads/${adId}/click`, { method: 'POST' }).catch(() => {});
  if (url) window.open(url, '_blank');
}

function showMallPopup(popup) {
  const seenKey = `sw_popup_seen_${popup.id}`;
  if (popup.show_once_per_session && sessionStorage.getItem(seenKey)) return;
  document.getElementById('mallPopupTitle').textContent = popup.title || '';
  const media = document.getElementById('mallPopupMedia');
  media.innerHTML = popup.media_type === 'video'
    ? `<video src="${popup.media_url}" autoplay muted loop playsinline></video>`
    : `<img src="${popup.media_url}" alt="" />`;
  const cta = document.getElementById('mallPopupCta');
  if (popup.cta_label) { cta.hidden = false; cta.textContent = popup.cta_label; cta.href = popup.cta_url || '#'; }
  else cta.hidden = true;
  document.getElementById('mallPopup').hidden = false;
  sessionStorage.setItem(seenKey, '1');
}
document.getElementById('mallPopupClose')?.addEventListener('click', () => { document.getElementById('mallPopup').hidden = true; });

// ---------------------------------------------------------------------
// HARİTA KONTROLLERİ + PARK YERİ HATIRLATMA (demo)
// ---------------------------------------------------------------------
document.getElementById('zoomIn')?.addEventListener('click', () => SmartWayMap.zoomIn());
document.getElementById('zoomOut')?.addEventListener('click', () => SmartWayMap.zoomOut());
document.getElementById('zoomReset')?.addEventListener('click', () => SmartWayMap.resetZoom());

document.getElementById('parkingBtn')?.addEventListener('click', () => {
  const saved = localStorage.getItem('sw_parking_spot');
  if (saved) {
    alert(`Kayıtlı park yeriniz: ${saved}\n(Bu demo sürümde konuma navigasyon eklenmedi.)`);
  } else {
    const spot = prompt('Park yerinizi kaydedin (örn: B2 - A Blok - 34):');
    if (spot) { localStorage.setItem('sw_parking_spot', spot); alert('Park yeriniz kaydedildi.'); }
  }
});

// ---------------------------------------------------------------------
// PDR — donanımsız yaklaşık konum takibi (Faz 4). QR ile alınan kesin
// başlangıç noktasından itibaren adım+yön sensörleriyle "mavi nokta"yı
// güncel tutar; sürüklenme birikeceğinden yalnızca görsel ipucu amaçlıdır.
// ---------------------------------------------------------------------
let pdrActive = false;
document.getElementById('pdrBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('pdrBtn');
  if (pdrActive) {
    SmartWayPDR.stop();
    SmartWayMap.clearPdrDot();
    pdrActive = false;
    btn.style.background = '';
    return;
  }
  if (!state.startNode) { alert('Önce bir QR okutmalısınız.'); return; }

  const ok = await SmartWayPDR.start((update) => {
    // update.x/y, QR başlangıç noktasına göre PİKSEL ofseti — harita
    // koordinatına eklenir. Kat değiştirmez (yalnızca aynı kat içi tahmini iz).
    const absX = state.startNode.x + update.x;
    const absY = state.startNode.y + update.y;
    SmartWayMap.updatePdrDot(absX, absY);
  });

  if (!ok) {
    alert('Bu cihaz/tarayıcı hareket sensörlerini desteklemiyor ya da izin verilmedi.');
    return;
  }
  SmartWayPDR.reset();
  pdrActive = true;
  btn.style.background = 'var(--gold-soft)';
});

// ---------------------------------------------------------------------
// SERVICE WORKER (offline)
// ---------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
}

initQrOverlay();
