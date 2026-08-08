// frontend/public/admin/js/super-admin.js
'use strict';

let session = AdminAuth.guard(['super_admin']);
const content = document.getElementById('content');

function boot() {
  if (!session) { showLogin(); return; }
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('shell').hidden = false;
  document.getElementById('userLabel').textContent = session.user.fullName || session.user.email;
  renderView('overview');
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
    if (data.user.role !== 'super_admin') { AdminAuth.clearSession(); throw new Error('Bu panel yalnızca platform yöneticileri içindir.'); }
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
    if (view === 'overview') return await renderOverview();
    if (view === 'malls') return await renderMalls();
    if (view === 'plans') return await renderPlans();
    if (view === 'invoices') return await renderInvoices();
    if (view === 'support') return await renderSupport();
  } catch (err) {
    content.innerHTML = `<div class="empty-state">Hata: ${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------
async function renderOverview() {
  const o = await AdminAuth.api('/api/superadmin/overview');
  content.innerHTML = `
    ${header('Platform Özeti', 'SmartWay AVM — tüm AVM\'ler geneli')}
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-card__label">Aktif AVM</div><div class="stat-card__value">${o.activeMalls}</div></div>
      <div class="stat-card"><div class="stat-card__label">Aktif Mağaza</div><div class="stat-card__value">${o.activeStores}</div></div>
      <div class="stat-card"><div class="stat-card__label">Aylık Yinelenen Gelir (MRR)</div><div class="stat-card__value">₺${o.mrr.toLocaleString('tr-TR')}</div></div>
      <div class="stat-card"><div class="stat-card__label">Açık Destek Talebi</div><div class="stat-card__value">${o.openTickets}</div></div>
    </div>`;
}

// ---------------------------------------------------------------------
async function renderMalls() {
  const [{ malls }, { plans }] = await Promise.all([AdminAuth.api('/api/superadmin/malls'), AdminAuth.api('/api/superadmin/plans')]);
  content.innerHTML = `
    ${header('AVM\'ler', `${malls.length} AVM platformda kayıtlı`)}
    <div class="panel">
      <div class="panel__head"><h3>AVM Listesi</h3><button class="btn btn--gold btn--sm" id="addMallBtn">+ Yeni AVM Onboarding</button></div>
      <table class="data-table">
        <thead><tr><th>AVM</th><th>Şehir</th><th>Plan</th><th>Mağaza</th><th>Durum</th><th></th></tr></thead>
        <tbody>
          ${malls.map((m) => `
            <tr>
              <td><strong>${escapeHtml(m.name)}</strong> <span class="muted">/${escapeHtml(m.slug)}</span></td>
              <td>${escapeHtml(m.city || '—')}</td>
              <td>${escapeHtml(m.plan_name || '—')}</td>
              <td>${m.store_count}</td>
              <td>${statusBadge(m.status)}</td>
              <td>
                ${m.status !== 'suspended'
                  ? `<button class="btn btn--danger btn--sm" data-suspend="${m.id}">Askıya Al</button>`
                  : `<button class="btn btn--ghost btn--sm" data-activate="${m.id}">Aktifleştir</button>`}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('[data-suspend]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Bu AVM hesabını askıya almak istediğinize emin misiniz?')) return;
      await AdminAuth.api(`/api/superadmin/malls/${btn.dataset.suspend}`, { method: 'PATCH', body: { status: 'suspended' } });
      toast('AVM askıya alındı.'); renderMalls();
    });
  });
  document.querySelectorAll('[data-activate]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await AdminAuth.api(`/api/superadmin/malls/${btn.dataset.activate}`, { method: 'PATCH', body: { status: 'active' } });
      toast('AVM aktifleştirildi.'); renderMalls();
    });
  });
  document.getElementById('addMallBtn').addEventListener('click', () => openMallForm(plans));
}

function statusBadge(status) {
  const map = { active: ['Aktif', 'success'], trial: ['Deneme', 'gold'], suspended: ['Askıda', 'danger'], cancelled: ['İptal', 'neutral'] };
  const [label, cls] = map[status] || [status, 'neutral'];
  return `<span class="badge badge--${cls}">${label}</span>`;
}

function openMallForm(plans) {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML = `
    <div class="modal-card">
      <div class="modal-card__head"><h3>Yeni AVM Onboarding</h3><button class="btn btn--ghost btn--sm" id="closeModal">✕</button></div>
      <div class="modal-card__body">
        <div class="form-grid">
          <div class="field"><label>AVM Adı</label><input id="mName" /></div>
          <div class="field"><label>Slug (URL)</label><input id="mSlug" placeholder="marina-park" /></div>
          <div class="field"><label>Şehir</label><input id="mCity" /></div>
          <div class="field"><label>Paket</label>
            <select id="mPlan">${plans.map((p) => `<option value="${p.code}">${escapeHtml(p.name)}</option>`).join('')}</select>
          </div>
          <div class="field form-grid--full"><label>Yönetici E-postası</label><input id="mAdminEmail" type="email" /></div>
          <div class="field form-grid--full"><label>Yönetici Şifresi</label><input id="mAdminPass" type="password" /></div>
        </div>
        <button class="btn btn--primary btn--block" id="submitMall" style="margin-top:14px">AVM'yi Oluştur</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  scrim.querySelector('#closeModal').addEventListener('click', () => scrim.remove());
  scrim.querySelector('#submitMall').addEventListener('click', async () => {
    try {
      await AdminAuth.api('/api/superadmin/malls', {
        method: 'POST',
        body: {
          name: scrim.querySelector('#mName').value,
          slug: scrim.querySelector('#mSlug').value,
          city: scrim.querySelector('#mCity').value,
          planCode: scrim.querySelector('#mPlan').value,
          adminEmail: scrim.querySelector('#mAdminEmail').value,
          adminPassword: scrim.querySelector('#mAdminPass').value,
        },
      });
      toast('AVM oluşturuldu.'); scrim.remove(); renderMalls();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------------------------------------------------------------
async function renderPlans() {
  const { plans } = await AdminAuth.api('/api/superadmin/plans');
  content.innerHTML = `
    ${header('Paketler', 'Lisans/plan tanımları')}
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Paket</th><th>Aylık Ücret</th><th>Maks. Mağaza</th><th>Maks. Kat</th></tr></thead>
        <tbody>
          ${plans.map((p) => `<tr><td><strong>${escapeHtml(p.name)}</strong></td><td>₺${(+p.monthly_price).toLocaleString('tr-TR')}</td><td>${p.max_stores}</td><td>${p.max_floors}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------
async function renderInvoices() {
  const { invoices } = await AdminAuth.api('/api/superadmin/invoices');
  content.innerHTML = `
    ${header('Faturalar', 'Tüm AVM\'lerin fatura geçmişi')}
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>AVM</th><th>Tutar</th><th>Dönem</th><th>Durum</th><th></th></tr></thead>
        <tbody>
          ${invoices.length ? invoices.map((i) => `
            <tr>
              <td>${escapeHtml(i.mall_name)}</td>
              <td>₺${(+i.amount).toLocaleString('tr-TR')}</td>
              <td>${fmtDate(i.period_start)} – ${fmtDate(i.period_end)}</td>
              <td>${i.status === 'paid' ? '<span class="badge badge--success">Ödendi</span>' : '<span class="badge badge--neutral">Bekliyor</span>'}</td>
              <td>${i.status !== 'paid' ? `<button class="btn btn--ghost btn--sm" data-mark-paid="${i.id}">Ödendi İşaretle</button>` : ''}</td>
            </tr>`).join('') : `<tr><td colspan="5" class="empty-state">Henüz fatura yok.</td></tr>`}
        </tbody>
      </table>
    </div>`;
  document.querySelectorAll('[data-mark-paid]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await AdminAuth.api(`/api/superadmin/invoices/${btn.dataset.markPaid}/mark-paid`, { method: 'PATCH' });
      toast('Fatura ödendi olarak işaretlendi.'); renderInvoices();
    });
  });
}

// ---------------------------------------------------------------------
async function renderSupport() {
  const { tickets } = await AdminAuth.api('/api/superadmin/support-tickets');
  content.innerHTML = `
    ${header('Destek Talepleri', 'AVM yöneticilerinden gelen talepler')}
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>AVM</th><th>Konu</th><th>Durum</th><th></th></tr></thead>
        <tbody>
          ${tickets.length ? tickets.map((t) => `
            <tr>
              <td>${escapeHtml(t.mall_name)}</td>
              <td>${escapeHtml(t.subject)}</td>
              <td>${ticketBadge(t.status)}</td>
              <td>${t.status !== 'closed' ? `<button class="btn btn--ghost btn--sm" data-close-ticket="${t.id}">Kapat</button>` : ''}</td>
            </tr>`).join('') : `<tr><td colspan="4" class="empty-state">Açık destek talebi yok.</td></tr>`}
        </tbody>
      </table>
    </div>`;
  document.querySelectorAll('[data-close-ticket]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await AdminAuth.api(`/api/superadmin/support-tickets/${btn.dataset.closeTicket}`, { method: 'PATCH', body: { status: 'closed' } });
      toast('Talep kapatıldı.'); renderSupport();
    });
  });
}
function ticketBadge(status) {
  const map = { open: ['Açık', 'danger'], in_progress: ['İşlemde', 'gold'], closed: ['Kapalı', 'neutral'] };
  const [label, cls] = map[status] || [status, 'neutral'];
  return `<span class="badge badge--${cls}">${label}</span>`;
}

boot();
