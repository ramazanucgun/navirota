// frontend/public/js/privacy.js
'use strict';

const API_BASE = '/api';
const MALL_SLUG = new URLSearchParams(location.search).get('mall') || 'terrace';
const visitorId = localStorage.getItem('sw_visitor_id');

const $ = (id) => document.getElementById(id);

function showStatus(message, isError = false) {
  const el = $('statusMsg');
  el.textContent = message;
  el.hidden = false;
  el.style.background = isError ? 'rgba(180,67,46,0.12)' : '';
  el.style.color = isError ? '#B4432E' : '';
}

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Mall-Slug': MALL_SLUG, ...(opts.headers || {}) },
  });
  return res;
}

function boot() {
  if (!visitorId) {
    $('noVisitorBox').hidden = false;
    return;
  }
  $('visitorIdLabel').textContent = visitorId;
  $('mainBox').hidden = false;
}

$('exportBtn')?.addEventListener('click', async () => {
  try {
    const res = await api(`/privacy/${visitorId}/export`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Veri indirilemedi.');
    }
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smartway-verilerim-${visitorId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showStatus('Verileriniz indirildi.');
  } catch (err) {
    showStatus(err.message, true);
  }
});

$('deleteBtn')?.addEventListener('click', () => {
  $('mainBox').hidden = true;
  $('confirmBox').hidden = false;
});

$('cancelDeleteBtn')?.addEventListener('click', () => {
  $('confirmBox').hidden = true;
  $('mainBox').hidden = false;
});

$('confirmDeleteBtn')?.addEventListener('click', async () => {
  try {
    const res = await api(`/privacy/${visitorId}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Silme işlemi başarısız oldu.');

    localStorage.removeItem('sw_visitor_id');
    $('confirmBox').hidden = true;
    $('doneMessage').textContent = body.message || 'Verileriniz kalıcı olarak silindi.';
    $('doneBox').hidden = false;
  } catch (err) {
    showStatus(err.message, true);
  }
});

boot();
