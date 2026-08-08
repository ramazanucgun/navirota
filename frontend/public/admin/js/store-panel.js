// frontend/public/admin/js/store-panel.js
'use strict';

let session = AdminAuth.guard(['store_manager']);
const content = document.getElementById('content');

function boot() {
  if (!session) { showLogin(); return; }
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('shell').hidden = false;
  document.getElementById('userLabel').textContent = session.user.fullName || session.user.email;
  renderView('overview');
  AdminAuth.api('/api/store/me').then(({ store }) => {
    document.getElementById('storeLabel').textContent = store.name;
  }).catch(() => {});
}
function showLogin() { document.getElementById('loginScreen').hidden = false; document.getElementById('shell').hidden = true; }

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  errBox.hidden = true;
  try {
    const data = await AdminAuth.login(email, password);
    if (data.user.role !== 'store_manager') { AdminAuth.clearSession(); throw new Error('Bu panel yalnızca mağaza yöneticileri içindir.'); }
    session = data; boot();
  } catch (err) { errBox.textContent = err.message; errBox.hidden = false; }
});
document.getElementById('logoutBtn').addEventListener('click', () => { AdminAuth.logout(); session = null; showLogin(); });

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((i) => i.classList.remove('active'));
    item.classList.add('active');
    renderView(item.dataset.view);
  });
});

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function header(title, sub) { return `<div class="content__header"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div></div>`; }

async function renderView(view) {
  content.innerHTML = `<div class="empty-state">Yükleniyor…</div>`;
  try {
    if (view === 'overview') return renderOverview();
    if (view === 'profile') return renderProfile();
    if (view === 'campaigns') return renderCampaigns();
    if (view === 'products') return renderProducts();
  } catch (err) {
    content.innerHTML = `<div class="empty-state">Hata: ${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------
async function renderOverview() {
  const { last30Days, activeCampaigns } = await AdminAuth.api('/api/store/stats');
  content.innerHTML = `
    ${header('İstatistikleriniz', 'Son 30 gün')}
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-card__label">Arama Sonuçlarında Görünme</div><div class="stat-card__value">${last30Days.searchAppearances}</div></div>
      <div class="stat-card"><div class="stat-card__label">Mağazanıza Alınan Rota</div><div class="stat-card__value">${last30Days.routesToStore}</div></div>
      <div class="stat-card"><div class="stat-card__label">Aktif Kampanya</div><div class="stat-card__value">${activeCampaigns}</div></div>
    </div>
    <div class="panel"><div class="panel__body">
      <p class="muted">Daha fazla ziyaretçi çekmek için aktif bir kampanya yayınlamayı unutmayın — arama sonuçlarında kampanyalı mağazalar önce gösterilir.</p>
    </div></div>`;
}

// ---------------------------------------------------------------------
async function renderProfile() {
  const { store } = await AdminAuth.api('/api/store/me');
  content.innerHTML = `
    ${header('Mağaza Profili', 'Ziyaretçilerin mağaza sayfanızda göreceği bilgiler.')}
    <div class="panel"><div class="panel__body">
      <div class="form-grid">
        <div class="field"><label>Telefon</label><input id="pPhone" value="${escapeHtml(store.phone || '')}" /></div>
        <div class="field"><label>Web Sitesi</label><input id="pWebsite" value="${escapeHtml(store.website || '')}" /></div>
        <div class="field form-grid--full"><label>Logo URL</label><input id="pLogo" value="${escapeHtml(store.logo_url || '')}" /></div>
        <div class="field form-grid--full"><label>Kapak Görseli URL</label><input id="pCover" value="${escapeHtml(store.cover_url || '')}" /></div>
        <div class="field form-grid--full"><label>Açıklama</label><textarea id="pDesc" rows="4">${escapeHtml(store.description || '')}</textarea></div>
      </div>
      <button class="btn btn--primary" id="saveProfile" style="margin-top:14px">Kaydet</button>
    </div></div>`;
  document.getElementById('saveProfile').addEventListener('click', async () => {
    try {
      await AdminAuth.api('/api/store/me', {
        method: 'PATCH',
        body: {
          phone: document.getElementById('pPhone').value,
          website: document.getElementById('pWebsite').value,
          logoUrl: document.getElementById('pLogo').value,
          coverUrl: document.getElementById('pCover').value,
          description: document.getElementById('pDesc').value,
        },
      });
      toast('Profil güncellendi.');
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------------------------------------------------------------
async function renderCampaigns() {
  const { campaigns } = await AdminAuth.api('/api/store/campaigns');
  content.innerHTML = `
    ${header('Kampanyalarım', 'Süreli indirim, kupon ve QR kupon oluşturun.')}
    <div class="panel">
      <div class="panel__head"><h3>Kampanyalar</h3><button class="btn btn--gold btn--sm" id="addCampaign">+ Yeni Kampanya</button></div>
      <table class="data-table">
        <thead><tr><th>Başlık</th><th>Rozet</th><th>Bitiş</th><th>Durum</th><th></th></tr></thead>
        <tbody>
          ${campaigns.length ? campaigns.map((c) => `
            <tr>
              <td>${escapeHtml(c.title)}</td>
              <td>${escapeHtml(c.badge || '—')}</td>
              <td>${fmtDate(c.ends_at)}</td>
              <td>${c.is_active ? '<span class="badge badge--success">Yayında</span>' : '<span class="badge badge--danger">Pasif</span>'}</td>
              <td>
                <button class="btn btn--ghost btn--sm" data-toggle-camp="${c.id}" data-active="${c.is_active}">${c.is_active ? 'Durdur' : 'Yayınla'}</button>
                <button class="btn btn--danger btn--sm" data-del-camp="${c.id}">Sil</button>
              </td>
            </tr>`).join('') : `<tr><td colspan="5" class="empty-state">Henüz kampanya oluşturmadınız.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('[data-toggle-camp]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const isActive = btn.dataset.active !== 'true';
      await AdminAuth.api(`/api/store/campaigns/${btn.dataset.toggleCamp}`, { method: 'PATCH', body: { isActive } });
      toast('Kampanya güncellendi.'); renderCampaigns();
    });
  });
  document.querySelectorAll('[data-del-camp]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Bu kampanyayı silmek istediğinize emin misiniz?')) return;
      await AdminAuth.api(`/api/store/campaigns/${btn.dataset.delCamp}`, { method: 'DELETE' });
      toast('Kampanya silindi.'); renderCampaigns();
    });
  });
  document.getElementById('addCampaign').addEventListener('click', openCampaignForm);
}

function openCampaignForm() {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML = `
    <div class="modal-card">
      <div class="modal-card__head"><h3>Yeni Kampanya</h3><button class="btn btn--ghost btn--sm" id="closeModal">✕</button></div>
      <div class="modal-card__body">
        <div class="form-grid">
          <div class="field form-grid--full"><label>Başlık</label><input id="cTitle" placeholder="Sezon Sonu İndirimi" /></div>
          <div class="field"><label>İndirim %</label><input id="cDiscount" type="number" /></div>
          <div class="field"><label>Rozet</label>
            <select id="cBadge"><option value="indirim">İndirim</option><option value="yeni">Yeni</option><option value="hediye">Hediye</option></select>
          </div>
          <div class="field"><label>Kupon Kodu (opsiyonel)</label><input id="cCoupon" placeholder="SWAVM50" /></div>
          <div class="field"><label>Bitiş Tarihi</label><input id="cEnd" type="date" /></div>
        </div>
        <button class="btn btn--primary btn--block" id="submitCamp" style="margin-top:14px">Kampanyayı Yayınla</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  scrim.querySelector('#closeModal').addEventListener('click', () => scrim.remove());
  scrim.querySelector('#submitCamp').addEventListener('click', async () => {
    try {
      await AdminAuth.api('/api/store/campaigns', {
        method: 'POST',
        body: {
          title: scrim.querySelector('#cTitle').value,
          discountPercent: Number(scrim.querySelector('#cDiscount').value) || undefined,
          badge: scrim.querySelector('#cBadge').value,
          couponCode: scrim.querySelector('#cCoupon').value || undefined,
          startsAt: new Date().toISOString(),
          endsAt: new Date(scrim.querySelector('#cEnd').value || Date.now() + 30*86400000).toISOString(),
        },
      });
      toast('Kampanya oluşturuldu.'); scrim.remove(); renderCampaigns();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------------------------------------------------------------
async function renderProducts() {
  const { products } = await AdminAuth.api('/api/store/products');
  content.innerHTML = `
    ${header('Ürünlerim', 'Mağaza sayfanızda görünecek ürün görselleri.')}
    <div class="panel">
      <div class="panel__head"><h3>Ürünler</h3><button class="btn btn--gold btn--sm" id="addProduct">+ Ürün Ekle</button></div>
      <table class="data-table">
        <thead><tr><th>Ürün</th><th>Fiyat</th><th></th></tr></thead>
        <tbody>
          ${products.length ? products.map((p) => `
            <tr><td>${escapeHtml(p.name)}</td><td>${p.price ? p.price + ' TL' : '—'}</td>
            <td><button class="btn btn--danger btn--sm" data-del-product="${p.id}">Sil</button></td></tr>
          `).join('') : `<tr><td colspan="3" class="empty-state">Henüz ürün eklenmedi.</td></tr>`}
        </tbody>
      </table>
    </div>`;
  document.querySelectorAll('[data-del-product]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await AdminAuth.api(`/api/store/products/${btn.dataset.delProduct}`, { method: 'DELETE' });
      toast('Ürün silindi.'); renderProducts();
    });
  });
  document.getElementById('addProduct').addEventListener('click', () => {
    const name = prompt('Ürün adı:'); if (!name) return;
    const price = prompt('Fiyat (TL, opsiyonel):');
    AdminAuth.api('/api/store/products', { method: 'POST', body: { name, price: price ? Number(price) : undefined } })
      .then(() => { toast('Ürün eklendi.'); renderProducts(); })
      .catch((err) => toast(err.message, true));
  });
}

boot();
