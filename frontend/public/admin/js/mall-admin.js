// frontend/public/admin/js/mall-admin.js
'use strict';

let session = AdminAuth.guard(['mall_admin']);
const content = document.getElementById('content');

function boot() {
  if (!session) { showLogin(); return; }
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('shell').hidden = false;
  document.getElementById('mallLabel').textContent = session.user.mallName || session.user.mallSlug || 'AVM';
  document.getElementById('userLabel').textContent = `${session.user.fullName || session.user.email}`;
  renderView('overview');
}
function showLogin() {
  document.getElementById('loginScreen').hidden = false;
  document.getElementById('shell').hidden = true;
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  errBox.hidden = true;
  try {
    const data = await AdminAuth.login(email, password);
    if (data.user.role !== 'mall_admin') {
      AdminAuth.clearSession();
      throw new Error('Bu panel yalnızca AVM yöneticileri içindir.');
    }
    session = data;
    boot();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  }
});
document.getElementById('logoutBtn').addEventListener('click', () => { AdminAuth.logout(); session = null; showLogin(); });

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((i) => i.classList.remove('active'));
    item.classList.add('active');
    renderView(item.dataset.view);
  });
});

async function renderView(view) {
  content.innerHTML = `<div class="empty-state">Yükleniyor…</div>`;
  try {
    if (view === 'overview') return await renderOverview();
    if (view === 'floors') return await renderFloors();
    if (view === 'stores') return await renderStores();
    if (view === 'campaigns') return await renderCampaigns();
    if (view === 'ads') return await renderAds();
    if (view === 'popups') return await renderPopups();
    if (view === 'users') return await renderUsers();
    if (view === 'signage') return await renderSignage();
    if (view === 'integrations') return await renderIntegrations();
    if (view === 'support') return await renderSupport();
  } catch (err) {
    content.innerHTML = `<div class="empty-state">Hata: ${escapeHtml(err.message)}</div>`;
  }
}

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function header(title, sub) {
  return `<div class="content__header"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div></div>`;
}

// ---------------------------------------------------------------------
// GENEL BAKIŞ
// ---------------------------------------------------------------------
async function renderOverview() {
  const [overview, topStores, hourly] = await Promise.all([
    AdminAuth.api('/api/admin/analytics/overview'),
    AdminAuth.api('/api/admin/analytics/top-stores'),
    AdminAuth.api('/api/admin/analytics/hourly'),
  ]);
  const d = overview.last30Days;
  const maxHour = Math.max(1, ...hourly.hourly.map((h) => h.count));

  content.innerHTML = `
    ${header('Genel Bakış', 'Son 30 gün')}
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-card__label">Aktif Mağaza</div><div class="stat-card__value">${overview.activeStores}</div></div>
      <div class="stat-card"><div class="stat-card__label">Arama</div><div class="stat-card__value">${d.searches}</div></div>
      <div class="stat-card"><div class="stat-card__label">Hesaplanan Rota</div><div class="stat-card__value">${d.routesCalculated}</div></div>
      <div class="stat-card"><div class="stat-card__label">Reklam Gösterimi</div><div class="stat-card__value">${d.adImpressions}</div></div>
      <div class="stat-card"><div class="stat-card__label">CTR</div><div class="stat-card__value">%${d.ctr}</div></div>
    </div>
    <div class="panel">
      <div class="panel__head"><h3>Saatlik Yoğunluk (son 7 gün)</h3></div>
      <div class="panel__body">
        <div class="bar-chart">
          ${hourly.hourly.map((h) => `<div class="bar-chart__bar" style="height:${Math.max(4, (h.count / maxHour) * 120)}px" title="${h.hour}:00 — ${h.count} rota"></div>`).join('')}
        </div>
        <div class="bar-chart__label">${hourly.hourly.map((h) => `<span>${h.hour}</span>`).join('')}</div>
      </div>
    </div>
    <div class="panel">
      <div class="panel__head"><h3>En Çok Rota Alınan Mağazalar</h3></div>
      <table class="data-table">
        <thead><tr><th>Mağaza</th><th>Rota Sayısı</th></tr></thead>
        <tbody>
          ${topStores.topStores.length ? topStores.topStores.map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${s.route_count}</td></tr>`).join('')
            : `<tr><td colspan="2" class="empty-state">Henüz veri yok.</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------
// KATLAR & QR
// ---------------------------------------------------------------------
async function renderFloors() {
  const { floors } = await AdminAuth.api('/api/admin/floors');
  content.innerHTML = `
    ${header('Katlar & QR Yönetimi', 'Kat planı yükleyin, QR kodlarını toplu üretin ve yazdırma durumunu takip edin.')}
    <div class="panel">
      <div class="panel__head">
        <h3>Katlar</h3>
        <button class="btn btn--gold btn--sm" id="addFloorBtn">+ Kat Ekle</button>
      </div>
      <table class="data-table">
        <thead><tr><th>Kat</th><th>Node Sayısı</th><th>Mağaza</th><th>İşlem</th></tr></thead>
        <tbody>
          ${floors.map((f) => `
            <tr>
              <td><strong>${escapeHtml(f.label)}</strong> <span class="muted">(seviye ${f.level_index})</span></td>
              <td>${f.node_count}</td>
              <td>${f.store_count}</td>
              <td>
                <button class="btn btn--ghost btn--sm" data-qr-floor="${f.id}">QR Üret</button>
                <button class="btn btn--gold btn--sm" data-edit-floor="${f.id}">🗺️ Haritayı Düzenle</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel__head"><h3>QR Kodları</h3><button class="btn btn--ghost btn--sm" id="refreshQrBtn">Yenile</button></div>
      <div class="panel__body" id="qrList"><div class="empty-state">Yükleniyor…</div></div>
    </div>`;

  document.getElementById('addFloorBtn').addEventListener('click', async () => {
    const label = prompt('Kat adı (örn: 2. Kat):');
    if (!label) return;
    const levelIndex = prompt('Seviye numarası (örn: 2):', floors.length);
    try {
      await AdminAuth.api('/api/admin/floors', { method: 'POST', body: { label, levelIndex: Number(levelIndex) } });
      toast('Kat eklendi.'); renderFloors();
    } catch (err) { toast(err.message, true); }
  });

  document.querySelectorAll('[data-qr-floor]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const r = await AdminAuth.api('/api/admin/qr/generate-all', { method: 'POST', body: { floorId: btn.dataset.qrFloor } });
        toast(`${r.created} yeni QR üretildi (toplam ${r.total} node).`);
        loadQrList();
      } catch (err) { toast(err.message, true); }
    });
  });
  document.querySelectorAll('[data-edit-floor]').forEach((btn) => {
    btn.addEventListener('click', () => renderFloorEditor(btn.dataset.editFloor));
  });

  document.getElementById('refreshQrBtn').addEventListener('click', loadQrList);
  loadQrList();
}

async function loadQrList() {
  const box = document.getElementById('qrList');
  const { qrCodes } = await AdminAuth.api('/api/admin/qr');
  if (!qrCodes.length) { box.innerHTML = '<div class="empty-state">Henüz QR üretilmedi. Yukarıdan bir kat için "QR Üret" butonuna basın.</div>'; return; }
  box.innerHTML = `<table class="data-table">
    <thead><tr><th>Kod</th><th>Tip</th><th>Kat</th><th>Durum</th><th></th></tr></thead>
    <tbody>${qrCodes.map((q) => `
      <tr>
        <td><code>${escapeHtml(q.code)}</code></td>
        <td>${escapeHtml(q.node_type)}</td>
        <td>${escapeHtml(q.floor_label)}</td>
        <td>${q.printed_at ? '<span class="badge badge--success">Basıldı</span>' : '<span class="badge badge--neutral">Bekliyor</span>'}</td>
        <td>${!q.printed_at ? `<button class="btn btn--ghost btn--sm" data-mark-printed="${q.id}">Basıldı İşaretle</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`;
  document.querySelectorAll('[data-mark-printed]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await AdminAuth.api(`/api/admin/qr/${btn.dataset.markPrinted}/printed`, { method: 'PATCH' });
      loadQrList();
    });
  });
}

// ---------------------------------------------------------------------
// KAT PLANI GÖRSEL EDİTÖRÜ — tıkla-node-ekle, iki node'a tıkla-bağla,
// SVG arka plan yükleme. Kaydedince PUT /floors/:id/graph çağrılır.
// ---------------------------------------------------------------------
const NODE_TYPES = [
  ['corridor', 'Koridor'], ['store_entrance', 'Mağaza Girişi'], ['elevator', 'Asansör'],
  ['escalator', 'Yürüyen Merdiven'], ['stairs', 'Merdiven'], ['exit', 'Çıkış'], ['poi', 'Diğer (WC/ATM/vb.)'],
];
const EDGE_TYPES = [['walk', 'Yürüyüş'], ['elevator', 'Asansör'], ['escalator', 'Yürüyen Merdiven'], ['stairs', 'Merdiven']];

let editorState = null; // { floorId, nodes:[{code,type,x,y,accessible}], edges:[{fromCode,toCode,weight,edgeType}], mode, pendingEdgeFrom, svgContent, viewbox }

async function renderFloorEditor(floorId) {
  const { floor, nodes, edges } = await AdminAuth.api(`/api/admin/floors/${floorId}/graph`);
  editorState = {
    floorId, nodes: nodes || [], edges: edges || [],
    mode: 'select', pendingEdgeFrom: null,
    svgContent: floor.svgContent || null,
    viewbox: (floor.viewbox || '0 0 1000 600').split(' ').map(Number),
  };

  content.innerHTML = `
    ${header(`${escapeHtml(floor.label)} — Harita Editörü`, 'Koridor/mağaza/asansör noktalarını tıklayarak yerleştirin, iki noktayı tıklayarak bağlayın.')}
    <div class="panel">
      <div class="panel__head">
        <h3>Araçlar</h3>
        <button class="btn btn--ghost btn--sm" id="backToFloors">← Katlara Dön</button>
      </div>
      <div class="panel__body">
        <div class="form-grid" style="margin-bottom:14px">
          <div class="field">
            <label>Mod</label>
            <select id="editorMode">
              <option value="select">Seç / Sil</option>
              <option value="add-node">+ Nokta Ekle</option>
              <option value="add-edge">🔗 İki Noktayı Bağla</option>
            </select>
          </div>
          <div class="field">
            <label>Arka Plan SVG (opsiyonel — sadece görsel referans)</label>
            <input type="file" id="svgFileInput" accept=".svg,image/svg+xml" />
          </div>
        </div>
        <div id="editorHint" class="muted" style="margin-bottom:10px;font-size:13px"></div>
        <div style="position:relative;border:1px solid var(--line-strong);border-radius:12px;overflow:hidden;background:#fff">
          <svg id="editorSvg" viewBox="${editorState.viewbox.join(' ')}" style="width:100%;height:520px;cursor:crosshair;display:block"></svg>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel__head">
        <h3>Noktalar (${editorState.nodes.length}) &amp; Bağlantılar (${editorState.edges.length})</h3>
        <button class="btn btn--primary btn--sm" id="saveGraphBtn">💾 Kaydet</button>
      </div>
      <div class="panel__body" id="graphSummary"></div>
    </div>`;

  document.getElementById('backToFloors').addEventListener('click', renderFloors);
  document.getElementById('editorMode').addEventListener('change', (e) => {
    editorState.mode = e.target.value;
    editorState.pendingEdgeFrom = null;
    updateEditorHint();
  });
  document.getElementById('svgFileInput').addEventListener('change', handleSvgUpload);
  document.getElementById('saveGraphBtn').addEventListener('click', saveGraph);

  updateEditorHint();
  drawEditorCanvas();
  renderGraphSummary();
}

function updateEditorHint() {
  const hints = {
    select: 'Bir noktaya tıklayıp "Sil" ile kaldırabilirsiniz.',
    'add-node': 'Haritada bir noktaya tıklayın — kod ve tip soracağız.',
    'add-edge': 'Birbirine bağlamak istediğiniz iki noktayı sırayla tıklayın.',
  };
  document.getElementById('editorHint').textContent = hints[editorState.mode] || '';
}

function drawEditorCanvas() {
  const svg = document.getElementById('editorSvg');
  svg.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => {
    const n = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  };

  // Arka plan referans SVG (varsa, soluk)
  if (editorState.svgContent) {
    const g = el('g', { opacity: '0.3' });
    g.innerHTML = editorState.svgContent.replace(/<\/?svg[^>]*>/g, '');
    svg.appendChild(g);
  }

  // Kenarlar
  editorState.edges.forEach((e) => {
    const a = editorState.nodes.find((n) => n.code === e.fromCode);
    const b = editorState.nodes.find((n) => n.code === e.toCode);
    if (!a || !b) return;
    svg.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#B5652C', 'stroke-width': 2 }));
  });

  // Noktalar
  editorState.nodes.forEach((n) => {
    const isPending = editorState.pendingEdgeFrom === n.code;
    const circle = el('circle', {
      cx: n.x, cy: n.y, r: 9,
      fill: isPending ? '#C79A3E' : (n.type === 'store_entrance' ? '#8C4A1D' : '#17140F'),
      stroke: '#fff', 'stroke-width': 2, style: 'cursor:pointer',
    });
    circle.addEventListener('click', (ev) => { ev.stopPropagation(); handleNodeClick(n); });
    svg.appendChild(circle);
    const label = el('text', { x: n.x + 12, y: n.y - 10, 'font-size': 11, fill: '#17140F', 'font-family': 'sans-serif' });
    label.textContent = n.code;
    svg.appendChild(label);
  });

  svg.onclick = (ev) => {
    if (editorState.mode !== 'add-node') return;
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    addNodeAt(Math.round(loc.x), Math.round(loc.y));
  };
}

function addNodeAt(x, y) {
  const code = prompt('Nokta kodu (benzersiz, örn: K0-C4 veya K0-STORE-ORNEK):');
  if (!code) return;
  if (editorState.nodes.some((n) => n.code === code)) { toast('Bu kod zaten kullanılıyor.', true); return; }
  const typeChoice = prompt(`Tip seçin:\n${NODE_TYPES.map(([v, l], i) => `${i + 1}) ${l}`).join('\n')}`, '1');
  const type = NODE_TYPES[Number(typeChoice) - 1]?.[0] || 'corridor';
  editorState.nodes.push({ code, type, x, y, accessible: true });
  drawEditorCanvas();
  renderGraphSummary();
}

function handleNodeClick(node) {
  if (editorState.mode === 'select') {
    if (!confirm(`"${node.code}" silinsin mi? (Bu noktaya bağlı kenarlar da silinir.)`)) return;
    editorState.nodes = editorState.nodes.filter((n) => n.code !== node.code);
    editorState.edges = editorState.edges.filter((e) => e.fromCode !== node.code && e.toCode !== node.code);
    drawEditorCanvas(); renderGraphSummary();
    return;
  }
  if (editorState.mode === 'add-edge') {
    if (!editorState.pendingEdgeFrom) {
      editorState.pendingEdgeFrom = node.code;
      drawEditorCanvas();
      return;
    }
    if (editorState.pendingEdgeFrom === node.code) { editorState.pendingEdgeFrom = null; drawEditorCanvas(); return; }
    const typeChoice = prompt(`Bağlantı tipi seçin:\n${EDGE_TYPES.map(([v, l], i) => `${i + 1}) ${l}`).join('\n')}`, '1');
    const edgeType = EDGE_TYPES[Number(typeChoice) - 1]?.[0] || 'walk';
    const weight = Number(prompt('Ağırlık/mesafe (varsayılan 1):', '1')) || 1;
    editorState.edges.push({ fromCode: editorState.pendingEdgeFrom, toCode: node.code, edgeType, weight, bidirectional: true });
    editorState.pendingEdgeFrom = null;
    drawEditorCanvas(); renderGraphSummary();
  }
}

function renderGraphSummary() {
  const box = document.getElementById('graphSummary');
  if (!box) return;
  box.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Kod</th><th>Tip</th><th>Koordinat</th></tr></thead>
      <tbody>${editorState.nodes.length ? editorState.nodes.map((n) => `<tr><td>${escapeHtml(n.code)}</td><td>${NODE_TYPES.find(t=>t[0]===n.type)?.[1] || n.type}</td><td>${n.x}, ${n.y}</td></tr>`).join('') : '<tr><td colspan="3" class="empty-state">Henüz nokta eklenmedi.</td></tr>'}</tbody>
    </table>`;
}

async function handleSvgUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  if (!text.includes('<svg')) { toast('Geçerli bir SVG dosyası değil.', true); return; }
  try {
    await AdminAuth.api(`/api/admin/floors/${editorState.floorId}/svg-content`, { method: 'PATCH', body: { svgContent: text } });
    editorState.svgContent = text;
    drawEditorCanvas();
    toast('Arka plan SVG kaydedildi.');
  } catch (err) { toast(err.message, true); }
}

async function saveGraph() {
  try {
    const r = await AdminAuth.api(`/api/admin/floors/${editorState.floorId}/graph`, {
      method: 'PUT', body: { nodes: editorState.nodes, edges: editorState.edges },
    });
    toast(`Kaydedildi: ${r.nodeCount} nokta, ${r.edgeCount} bağlantı.`);
  } catch (err) { toast(err.message, true); }
}

// ---------------------------------------------------------------------
// MAĞAZALAR
// ---------------------------------------------------------------------
async function renderStores() {
  const [{ stores }, { floors }] = await Promise.all([AdminAuth.api('/api/admin/stores'), AdminAuth.api('/api/admin/floors')]);
  content.innerHTML = `
    ${header('Mağazalar', `${stores.length} mağaza kayıtlı`)}
    <div class="panel">
      <div class="panel__head"><h3>Mağaza Listesi</h3><button class="btn btn--gold btn--sm" id="addStoreBtn">+ Mağaza Ekle</button></div>
      <table class="data-table">
        <thead><tr><th>Mağaza</th><th>Kat</th><th>Kategori</th><th>Durum</th><th></th></tr></thead>
        <tbody>
          ${stores.map((s) => `
            <tr>
              <td><strong>${escapeHtml(s.name)}</strong></td>
              <td>${escapeHtml(s.floor_label)}</td>
              <td>${(s.categories || []).map(escapeHtml).join(', ') || '—'}</td>
              <td>${s.is_active ? '<span class="badge badge--success">Aktif</span>' : '<span class="badge badge--danger">Pasif</span>'}</td>
              <td><button class="btn btn--ghost btn--sm" data-toggle-store="${s.id}" data-active="${s.is_active}">${s.is_active ? 'Pasifleştir' : 'Aktifleştir'}</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.getElementById('addStoreBtn').addEventListener('click', () => openStoreForm(floors));
  document.querySelectorAll('[data-toggle-store]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const isActive = btn.dataset.active !== 'true';
      await AdminAuth.api(`/api/admin/stores/${btn.dataset.toggleStore}`, { method: 'PATCH', body: { isActive } });
      toast('Mağaza güncellendi.'); renderStores();
    });
  });
}

function openStoreForm(floors) {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML = `
    <div class="modal-card">
      <div class="modal-card__head"><h3>Yeni Mağaza</h3><button class="btn btn--ghost btn--sm" id="closeModal">✕</button></div>
      <div class="modal-card__body">
        <div class="form-grid">
          <div class="field"><label>Mağaza Adı</label><input id="fName" /></div>
          <div class="field"><label>Slug</label><input id="fSlug" placeholder="orn-magaza" /></div>
          <div class="field"><label>Kat</label>
            <select id="fFloor">${floors.map((f) => `<option value="${f.id}">${escapeHtml(f.label)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Giriş Noktası</label>
            <select id="fEntranceNode"><option value="">Yükleniyor…</option></select>
          </div>
          <div class="field"><label>Ünite No</label><input id="fUnit" /></div>
          <div class="field form-grid--full"><label>Yönetici E-postası (opsiyonel)</label><input id="fMgrEmail" type="email" /></div>
          <div class="field form-grid--full"><label>Yönetici Şifresi (opsiyonel)</label><input id="fMgrPass" type="password" /></div>
        </div>
        <p class="muted" style="font-size:12px;margin-top:6px">Giriş noktası listesi boşsa, önce "Katlar &amp; QR" → "Haritayı Düzenle"den bu kata bir "Mağaza Girişi" noktası ekleyin.</p>
        <button class="btn btn--primary btn--block" id="submitStore" style="margin-top:14px">Mağaza Oluştur</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  scrim.querySelector('#closeModal').addEventListener('click', () => scrim.remove());

  async function loadEntranceNodes(floorId) {
    const sel = scrim.querySelector('#fEntranceNode');
    sel.innerHTML = '<option value="">Yükleniyor…</option>';
    try {
      const { entranceNodes } = await AdminAuth.api(`/api/admin/floors/${floorId}/entrance-nodes`);
      sel.innerHTML = entranceNodes.length
        ? `<option value="">— Seçilmedi (rota hesaplanamaz) —</option>` + entranceNodes.map((n) => `<option value="${n.id}">${escapeHtml(n.code)}</option>`).join('')
        : `<option value="">Bu katta giriş noktası yok</option>`;
    } catch { sel.innerHTML = '<option value="">Yüklenemedi</option>'; }
  }
  loadEntranceNodes(floors[0]?.id);
  scrim.querySelector('#fFloor').addEventListener('change', (e) => loadEntranceNodes(e.target.value));

  scrim.querySelector('#submitStore').addEventListener('click', async () => {
    try {
      await AdminAuth.api('/api/admin/stores', {
        method: 'POST',
        body: {
          name: scrim.querySelector('#fName').value,
          slug: scrim.querySelector('#fSlug').value,
          floorId: scrim.querySelector('#fFloor').value,
          entranceNodeId: scrim.querySelector('#fEntranceNode').value || undefined,
          unitNo: scrim.querySelector('#fUnit').value,
          managerEmail: scrim.querySelector('#fMgrEmail').value || undefined,
          managerPassword: scrim.querySelector('#fMgrPass').value || undefined,
        },
      });
      toast('Mağaza oluşturuldu.'); scrim.remove(); renderStores();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------------------------------------------------------------
// KAMPANYALAR (moderasyon + kategori kampanyaları)
// ---------------------------------------------------------------------
async function renderCampaigns() {
  const [{ campaigns }, { categoryCampaigns }] = await Promise.all([
    AdminAuth.api('/api/admin/campaigns'), AdminAuth.api('/api/admin/category-campaigns'),
  ]);
  content.innerHTML = `
    ${header('Kampanyalar', 'Mağaza kampanyalarını onaylayın/durdurun, kategori kampanyası oluşturun.')}
    <div class="panel">
      <div class="panel__head"><h3>Mağaza Kampanyaları</h3></div>
      <table class="data-table">
        <thead><tr><th>Mağaza</th><th>Kampanya</th><th>Bitiş</th><th>Durum</th><th></th></tr></thead>
        <tbody>
          ${campaigns.length ? campaigns.map((c) => `
            <tr>
              <td>${escapeHtml(c.store_name)}</td>
              <td>${escapeHtml(c.title)}</td>
              <td>${fmtDate(c.ends_at)}</td>
              <td>${c.is_active ? '<span class="badge badge--success">Yayında</span>' : '<span class="badge badge--danger">Durduruldu</span>'}</td>
              <td><button class="btn btn--ghost btn--sm" data-mod-campaign="${c.id}" data-active="${c.is_active}">${c.is_active ? 'Durdur' : 'Onayla'}</button></td>
            </tr>`).join('') : `<tr><td colspan="5" class="empty-state">Henüz kampanya yok.</td></tr>`}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel__head"><h3>Kategori Kampanyaları</h3><button class="btn btn--gold btn--sm" id="addCatCampaign">+ Yeni</button></div>
      <table class="data-table">
        <thead><tr><th>Kategori</th><th>Başlık</th><th>İndirim</th><th>Bitiş</th></tr></thead>
        <tbody>
          ${categoryCampaigns.length ? categoryCampaigns.map((c) => `
            <tr><td>${escapeHtml(c.category_name)}</td><td>${escapeHtml(c.title)}</td><td>${c.discount_percent ? '%' + c.discount_percent : '—'}</td><td>${fmtDate(c.ends_at)}</td></tr>
          `).join('') : `<tr><td colspan="4" class="empty-state">Henüz kategori kampanyası yok.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('[data-mod-campaign]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const isActive = btn.dataset.active !== 'true';
      await AdminAuth.api(`/api/admin/campaigns/${btn.dataset.modCampaign}/moderate`, { method: 'PATCH', body: { isActive } });
      toast('Kampanya güncellendi.'); renderCampaigns();
    });
  });
  document.getElementById('addCatCampaign').addEventListener('click', async () => {
    const { categories } = await AdminAuth.api('/api/admin/categories').catch(() => ({ categories: [] }));
    openCategoryCampaignForm(categories);
  });
}

function openCategoryCampaignForm(categories) {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML = `
    <div class="modal-card">
      <div class="modal-card__head"><h3>Kategori Kampanyası</h3><button class="btn btn--ghost btn--sm" id="closeModal">✕</button></div>
      <div class="modal-card__body">
        <div class="form-grid">
          <div class="field form-grid--full"><label>Kategori</label>
            <select id="cCat">${categories.map((c) => `<option value="${c.code}">${escapeHtml(c.name_tr)}</option>`).join('')}</select>
          </div>
          <div class="field form-grid--full"><label>Başlık</label><input id="cTitle" placeholder="Tüm ayakkabı mağazalarında %20" /></div>
          <div class="field"><label>İndirim %</label><input id="cDiscount" type="number" /></div>
          <div class="field"><label>Bitiş Tarihi</label><input id="cEnd" type="date" /></div>
        </div>
        <button class="btn btn--primary btn--block" id="submitCat" style="margin-top:14px">Oluştur</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  scrim.querySelector('#closeModal').addEventListener('click', () => scrim.remove());
  scrim.querySelector('#submitCat').addEventListener('click', async () => {
    try {
      await AdminAuth.api('/api/admin/category-campaigns', {
        method: 'POST',
        body: {
          categoryCode: scrim.querySelector('#cCat').value,
          title: scrim.querySelector('#cTitle').value,
          discountPercent: Number(scrim.querySelector('#cDiscount').value) || null,
          startsAt: new Date().toISOString(),
          endsAt: new Date(scrim.querySelector('#cEnd').value || Date.now() + 30*86400000).toISOString(),
        },
      });
      toast('Kategori kampanyası oluşturuldu.'); scrim.remove(); renderCampaigns();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------------------------------------------------------------
// REKLAMLAR
// ---------------------------------------------------------------------
async function renderAds() {
  const { ads } = await AdminAuth.api('/api/admin/ads');
  content.innerHTML = `
    ${header('Reklam Envanteri', 'Gösterim, tıklama ve CTR raporları ile reklam yönetimi.')}
    <div class="panel">
      <div class="panel__head"><h3>Reklamlar</h3><button class="btn btn--gold btn--sm" id="addAdBtn">+ Reklam Ekle</button></div>
      <table class="data-table">
        <thead><tr><th>Reklamveren</th><th>Alan</th><th>Gösterim</th><th>Tıklama</th><th>CTR</th><th>Durum</th><th></th></tr></thead>
        <tbody>
          ${ads.length ? ads.map((a) => `
            <tr>
              <td>${escapeHtml(a.advertiser_name || '—')}</td>
              <td>${escapeHtml(a.slot_name)}</td>
              <td>${a.impressions}</td>
              <td>${a.clicks}</td>
              <td>%${a.ctr}</td>
              <td>${a.is_active ? '<span class="badge badge--success">Aktif</span>' : '<span class="badge badge--danger">Pasif</span>'}</td>
              <td><button class="btn btn--ghost btn--sm" data-toggle-ad="${a.id}" data-active="${a.is_active}">${a.is_active ? 'Durdur' : 'Başlat'}</button></td>
            </tr>`).join('') : `<tr><td colspan="7" class="empty-state">Henüz reklam yok.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('[data-toggle-ad]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const isActive = btn.dataset.active !== 'true';
      await AdminAuth.api(`/api/admin/ads/${btn.dataset.toggleAd}`, { method: 'PATCH', body: { isActive } });
      toast('Reklam güncellendi.'); renderAds();
    });
  });
  document.getElementById('addAdBtn').addEventListener('click', async () => {
    const { slots } = await AdminAuth.api('/api/admin/ad-slots');
    openAdForm(slots);
  });
}

function openAdForm(slots) {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML = `
    <div class="modal-card">
      <div class="modal-card__head"><h3>Yeni Reklam</h3><button class="btn btn--ghost btn--sm" id="closeModal">✕</button></div>
      <div class="modal-card__body">
        <div class="form-grid">
          <div class="field"><label>Reklamveren</label><input id="aName" /></div>
          <div class="field"><label>Alan (Slot)</label>
            <select id="aSlot">${slots.map((s) => `<option value="${s.code}">${escapeHtml(s.name)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Tip</label>
            <select id="aType"><option value="banner">Banner</option><option value="video">Video</option><option value="gif">GIF</option></select>
          </div>
          <div class="field"><label>Öncelik</label><input id="aPriority" type="number" value="0" /></div>
          <div class="field form-grid--full"><label>Görsel/Video URL</label><input id="aUrl" placeholder="https://…" /></div>
          <div class="field form-grid--full"><label>Tıklama URL (opsiyonel)</label><input id="aClickUrl" placeholder="https://…" /></div>
          <div class="field"><label>Başlangıç</label><input id="aStart" type="date" /></div>
          <div class="field"><label>Bitiş</label><input id="aEnd" type="date" /></div>
        </div>
        <button class="btn btn--primary btn--block" id="submitAd" style="margin-top:14px">Reklamı Yayınla</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  scrim.querySelector('#closeModal').addEventListener('click', () => scrim.remove());
  scrim.querySelector('#submitAd').addEventListener('click', async () => {
    try {
      await AdminAuth.api('/api/admin/ads', {
        method: 'POST',
        body: {
          advertiserName: scrim.querySelector('#aName').value,
          slotCode: scrim.querySelector('#aSlot').value,
          creativeType: scrim.querySelector('#aType').value,
          creativeUrl: scrim.querySelector('#aUrl').value,
          clickUrl: scrim.querySelector('#aClickUrl').value || undefined,
          priority: Number(scrim.querySelector('#aPriority').value) || 0,
          startsAt: new Date(scrim.querySelector('#aStart').value || Date.now()).toISOString(),
          endsAt: new Date(scrim.querySelector('#aEnd').value || Date.now() + 30*86400000).toISOString(),
        },
      });
      toast('Reklam oluşturuldu.'); scrim.remove(); renderAds();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------------------------------------------------------------
// DUYURULAR (AVM popup)
// ---------------------------------------------------------------------
async function renderPopups() {
  const { popups } = await AdminAuth.api('/api/admin/popups');
  content.innerHTML = `
    ${header('AVM Duyuruları', 'Tam ekran popup ile ziyaretçilere etkinlik/kampanya duyurusu yayınlayın.')}
    <div class="panel">
      <div class="panel__head"><h3>Duyurular</h3><button class="btn btn--gold btn--sm" id="addPopupBtn">+ Duyuru Ekle</button></div>
      <table class="data-table">
        <thead><tr><th>Başlık</th><th>Tip</th><th>Bitiş</th><th>Durum</th><th></th></tr></thead>
        <tbody>
          ${popups.length ? popups.map((p) => `
            <tr>
              <td>${escapeHtml(p.title || '—')}</td>
              <td>${escapeHtml(p.media_type)}</td>
              <td>${fmtDate(p.ends_at)}</td>
              <td>${p.is_active ? '<span class="badge badge--success">Aktif</span>' : '<span class="badge badge--danger">Pasif</span>'}</td>
              <td><button class="btn btn--ghost btn--sm" data-toggle-popup="${p.id}" data-active="${p.is_active}">${p.is_active ? 'Durdur' : 'Başlat'}</button></td>
            </tr>`).join('') : `<tr><td colspan="5" class="empty-state">Henüz duyuru yok.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('[data-toggle-popup]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const isActive = btn.dataset.active !== 'true';
      await AdminAuth.api(`/api/admin/popups/${btn.dataset.togglePopup}`, { method: 'PATCH', body: { isActive } });
      toast('Duyuru güncellendi.'); renderPopups();
    });
  });
  document.getElementById('addPopupBtn').addEventListener('click', openPopupForm);
}

function openPopupForm() {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML = `
    <div class="modal-card">
      <div class="modal-card__head"><h3>Yeni Duyuru</h3><button class="btn btn--ghost btn--sm" id="closeModal">✕</button></div>
      <div class="modal-card__body">
        <div class="form-grid">
          <div class="field form-grid--full"><label>Başlık</label><input id="pTitle" /></div>
          <div class="field"><label>Medya Tipi</label>
            <select id="pType"><option value="image">Görsel</option><option value="video">Video</option><option value="gif">GIF</option></select>
          </div>
          <div class="field"><label>Bitiş Tarihi</label><input id="pEnd" type="date" /></div>
          <div class="field form-grid--full"><label>Medya URL</label><input id="pUrl" placeholder="https://…" /></div>
          <div class="field form-grid--full"><label>CTA Etiketi (opsiyonel)</label><input id="pCta" placeholder="Detayları Gör" /></div>
        </div>
        <button class="btn btn--primary btn--block" id="submitPopup" style="margin-top:14px">Yayınla</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  scrim.querySelector('#closeModal').addEventListener('click', () => scrim.remove());
  scrim.querySelector('#submitPopup').addEventListener('click', async () => {
    try {
      await AdminAuth.api('/api/admin/popups', {
        method: 'POST',
        body: {
          title: scrim.querySelector('#pTitle').value,
          mediaType: scrim.querySelector('#pType').value,
          mediaUrl: scrim.querySelector('#pUrl').value,
          ctaLabel: scrim.querySelector('#pCta').value || undefined,
          startsAt: new Date().toISOString(),
          endsAt: new Date(scrim.querySelector('#pEnd').value || Date.now() + 14*86400000).toISOString(),
        },
      });
      toast('Duyuru yayınlandı.'); scrim.remove(); renderPopups();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------------------------------------------------------------
// KULLANICILAR (çoklu yönetici)
// ---------------------------------------------------------------------
async function renderUsers() {
  const { users } = await AdminAuth.api('/api/admin/users');
  content.innerHTML = `
    ${header('Kullanıcı Yetkileri', 'AVM yöneticileri ve mağaza kullanıcılarını yönetin.')}
    <div class="panel">
      <div class="panel__head"><h3>Kullanıcılar</h3><button class="btn btn--gold btn--sm" id="addUserBtn">+ Kullanıcı Davet Et</button></div>
      <table class="data-table">
        <thead><tr><th>Ad</th><th>E-posta</th><th>Rol</th><th>Mağaza</th><th>Durum</th><th></th></tr></thead>
        <tbody>
          ${users.map((u) => `
            <tr>
              <td>${escapeHtml(u.full_name || '—')}</td>
              <td>${escapeHtml(u.email)}</td>
              <td><span class="badge badge--gold">${u.role === 'mall_admin' ? 'AVM Yöneticisi' : 'Mağaza Yöneticisi'}</span></td>
              <td>${escapeHtml(u.store_name || '—')}</td>
              <td>${u.is_active ? '<span class="badge badge--success">Aktif</span>' : '<span class="badge badge--danger">Pasif</span>'}</td>
              <td><button class="btn btn--ghost btn--sm" data-toggle-user="${u.id}" data-active="${u.is_active}">${u.is_active ? 'Pasifleştir' : 'Aktifleştir'}</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  document.querySelectorAll('[data-toggle-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const isActive = btn.dataset.active !== 'true';
      await AdminAuth.api(`/api/admin/users/${btn.dataset.toggleUser}`, { method: 'PATCH', body: { isActive } });
      toast('Kullanıcı güncellendi.'); renderUsers();
    });
  });
  document.getElementById('addUserBtn').addEventListener('click', () => {
    const email = prompt('E-posta:'); if (!email) return;
    const password = prompt('Geçici şifre:'); if (!password) return;
    const fullName = prompt('Ad Soyad:') || '';
    AdminAuth.api('/api/admin/users', { method: 'POST', body: { email, password, fullName, role: 'mall_admin' } })
      .then(() => { toast('Kullanıcı davet edildi.'); renderUsers(); })
      .catch((err) => toast(err.message, true));
  });
}

// ---------------------------------------------------------------------
// DESTEK
// ---------------------------------------------------------------------
async function renderSupport() {
  content.innerHTML = `
    ${header('Destek', 'SmartWay ekibine talep gönderin.')}
    <div class="panel"><div class="panel__body">
      <div class="field"><label>Konu</label><input id="sSubject" /></div>
      <div class="field"><label>Mesaj</label><textarea id="sMessage" rows="4"></textarea></div>
      <button class="btn btn--primary" id="sendTicket">Gönder</button>
    </div></div>`;
  document.getElementById('sendTicket').addEventListener('click', async () => {
    try {
      await AdminAuth.api('/api/admin/support-tickets', {
        method: 'POST',
        body: { subject: document.getElementById('sSubject').value, message: document.getElementById('sMessage').value },
      });
      toast('Destek talebiniz iletildi.');
      document.getElementById('sSubject').value = ''; document.getElementById('sMessage').value = '';
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------------------------------------------------------------
// SIGNAGE / KIOSK
// ---------------------------------------------------------------------
async function renderSignage() {
  const [{ devices }, { playlists }] = await Promise.all([
    AdminAuth.api('/api/admin/signage/devices'), AdminAuth.api('/api/admin/signage/playlists'),
  ]);
  content.innerHTML = `
    ${header('Dijital Signage & Kiosk', 'AVM içi ekranları eşleştirin, içerik playlist\'i atayın.')}
    <div class="panel">
      <div class="panel__head"><h3>Playlist\'ler</h3><button class="btn btn--gold btn--sm" id="addPlaylist">+ Playlist</button></div>
      <table class="data-table">
        <thead><tr><th>Ad</th><th>İçerik Sayısı</th></tr></thead>
        <tbody>${playlists.length ? playlists.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${p.item_count}</td></tr>`).join('') : `<tr><td colspan="2" class="empty-state">Henüz playlist yok.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel__head"><h3>Ekranlar</h3><button class="btn btn--gold btn--sm" id="addDevice">+ Ekran Ekle</button></div>
      <table class="data-table">
        <thead><tr><th>Ad</th><th>Eşleştirme Kodu</th><th>Playlist</th><th>Son Görülme</th></tr></thead>
        <tbody>
          ${devices.length ? devices.map((d) => `
            <tr>
              <td>${escapeHtml(d.name)} <span class="muted">${escapeHtml(d.location_label || '')}</span></td>
              <td><code style="font-size:15px;letter-spacing:2px">${escapeHtml(d.pairing_code)}</code></td>
              <td>
                <select data-assign-playlist="${d.id}">
                  <option value="">— Seçilmedi —</option>
                  ${playlists.map((p) => `<option value="${p.id}" ${d.playlist_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
              </td>
              <td>${d.last_seen_at ? fmtDate(d.last_seen_at) : '<span class="badge badge--neutral">Hiç bağlanmadı</span>'}</td>
            </tr>`).join('') : `<tr><td colspan="4" class="empty-state">Henüz ekran eklenmedi.</td></tr>`}
        </tbody>
      </table>
    </div>
    <div class="panel"><div class="panel__body">
      <p class="muted">Kiosk cihazında <code>/kiosk.html</code> adresini açıp yukarıdaki eşleştirme kodunu girin.</p>
    </div></div>`;

  document.getElementById('addPlaylist').addEventListener('click', async () => {
    const name = prompt('Playlist adı:'); if (!name) return;
    await AdminAuth.api('/api/admin/signage/playlists', { method: 'POST', body: { name } });
    toast('Playlist oluşturuldu.'); renderSignage();
  });
  document.getElementById('addDevice').addEventListener('click', async () => {
    const name = prompt('Ekran adı (örn: Ana Giriş Ekranı):'); if (!name) return;
    const locationLabel = prompt('Konum etiketi (opsiyonel):') || undefined;
    const r = await AdminAuth.api('/api/admin/signage/devices', { method: 'POST', body: { name, locationLabel } });
    toast(`Ekran oluşturuldu. Eşleştirme kodu: ${r.device.pairing_code}`);
    renderSignage();
  });
  document.querySelectorAll('[data-assign-playlist]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      await AdminAuth.api(`/api/admin/signage/devices/${sel.dataset.assignPlaylist}`, { method: 'PATCH', body: { playlistId: sel.value || null } });
      toast('Playlist atandı.');
    });
  });
}

// ---------------------------------------------------------------------
// ENTEGRASYONLAR (API anahtarları + webhook'lar)
// ---------------------------------------------------------------------
async function renderIntegrations() {
  const [{ apiKeys }, { webhooks, availableEvents }] = await Promise.all([
    AdminAuth.api('/api/admin/api-keys'), AdminAuth.api('/api/admin/webhooks'),
  ]);
  content.innerHTML = `
    ${header('Entegrasyonlar', 'Üçüncü parti sistemler (ERP/CRM) için API anahtarı ve webhook yönetimi.')}
    <div class="panel">
      <div class="panel__head"><h3>API Anahtarları</h3><button class="btn btn--gold btn--sm" id="addKey">+ Yeni Anahtar</button></div>
      <table class="data-table">
        <thead><tr><th>Etiket</th><th>Önek</th><th>Yetki</th><th>Durum</th><th></th></tr></thead>
        <tbody>
          ${apiKeys.length ? apiKeys.map((k) => `
            <tr>
              <td>${escapeHtml(k.label)}</td>
              <td><code>${escapeHtml(k.key_prefix)}…</code></td>
              <td>${k.scopes.map((s) => `<span class="badge badge--gold">${s}</span>`).join(' ')}</td>
              <td>${k.revoked_at ? '<span class="badge badge--danger">İptal</span>' : '<span class="badge badge--success">Aktif</span>'}</td>
              <td>${!k.revoked_at ? `<button class="btn btn--danger btn--sm" data-revoke-key="${k.id}">İptal Et</button>` : ''}</td>
            </tr>`).join('') : `<tr><td colspan="5" class="empty-state">Henüz API anahtarı yok.</td></tr>`}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel__head"><h3>Webhook'lar</h3><button class="btn btn--gold btn--sm" id="addWebhook">+ Webhook Ekle</button></div>
      <table class="data-table">
        <thead><tr><th>URL</th><th>Olaylar</th><th>Başarılı/Başarısız</th><th>Durum</th></tr></thead>
        <tbody>
          ${webhooks.length ? webhooks.map((w) => `
            <tr>
              <td>${escapeHtml(w.target_url)}</td>
              <td>${w.events.map(escapeHtml).join(', ')}</td>
              <td>${w.success_count} / ${w.fail_count}</td>
              <td>${w.is_active ? '<span class="badge badge--success">Aktif</span>' : '<span class="badge badge--danger">Pasif</span>'}</td>
            </tr>`).join('') : `<tr><td colspan="4" class="empty-state">Henüz webhook yok.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  document.getElementById('addKey').addEventListener('click', async () => {
    const label = prompt('Anahtar etiketi (örn: ERP Entegrasyonu):'); if (!label) return;
    const wantsWrite = confirm('Bu anahtar yazma (write) yetkisine de sahip olsun mu? Tamam = evet, İptal = yalnızca okuma.');
    const r = await AdminAuth.api('/api/admin/api-keys', { method: 'POST', body: { label, scopes: wantsWrite ? ['read', 'write'] : ['read'] } });
    alert(`Anahtar oluşturuldu — yalnızca ŞİMDİ gösteriliyor, kaydedin:\n\n${r.rawKey}`);
    renderIntegrations();
  });
  document.querySelectorAll('[data-revoke-key]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Bu anahtarı iptal etmek istediğinize emin misiniz?')) return;
      await AdminAuth.api(`/api/admin/api-keys/${btn.dataset.revokeKey}`, { method: 'DELETE' });
      toast('Anahtar iptal edildi.'); renderIntegrations();
    });
  });
  document.getElementById('addWebhook').addEventListener('click', async () => {
    const targetUrl = prompt('Hedef URL (https://…):'); if (!targetUrl) return;
    const events = prompt(`Olaylar (virgülle ayırın)\nSeçenekler: ${availableEvents.join(', ')}`, availableEvents[0]);
    if (!events) return;
    try {
      const r = await AdminAuth.api('/api/admin/webhooks', { method: 'POST', body: { targetUrl, events: events.split(',').map((e) => e.trim()) } });
      alert(`Webhook oluşturuldu. İmza sırrı (secret) — YALNIZCA ŞİMDİ gösteriliyor:\n\n${r.webhook.secret}`);
      renderIntegrations();
    } catch (err) { toast(err.message, true); }
  });
}

// uygulamayı başlat
boot();
