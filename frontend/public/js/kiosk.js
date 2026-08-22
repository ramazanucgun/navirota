// frontend/public/js/kiosk.js
// Önceden kiosk.html içinde inline <script> idi; sıkı bir CSP
// (script-src 'self', 'unsafe-inline' yok) uygulayabilmek için harici
// dosyaya taşındı. Davranış birebir korunmuştur.
'use strict';
const stage = document.getElementById('stage');
const errorBanner = document.getElementById('errorBanner');
let pairingCode = localStorage.getItem('sw_kiosk_pairing_code');
let items = [];
let idx = 0;
let timer = null;

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.style.display = 'block';
  setTimeout(() => errorBanner.style.display = 'none', 4000);
}

async function fetchPlaylist() {
  try {
    const res = await fetch(`/api/signage/${pairingCode}/playlist`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Cihaz bulunamadı.');
    }
    const data = await res.json();
    document.getElementById('deviceLabel').textContent = `${data.device.mallName} · ${data.device.name}`;
    if (JSON.stringify(data.items) !== JSON.stringify(items)) {
      items = data.items;
      idx = 0;
      renderStage();
    }
  } catch (err) {
    showError(err.message);
    if (err.message.includes('bulunamadı')) {
      localStorage.removeItem('sw_kiosk_pairing_code');
      document.getElementById('pairScreen').style.display = 'flex';
      stage.style.display = 'none';
    }
  }
}

function renderStage() {
  clearTimeout(timer);
  stage.innerHTML = '';
  if (!items.length) {
    const waiting = document.createElement('div');
    waiting.className = 'stage__waiting';
    waiting.textContent = 'İçerik bekleniyor…';
    stage.appendChild(waiting);
    timer = setTimeout(fetchPlaylist, 8000);
    return;
  }
  const item = items[idx % items.length];
  const el = item.media.type === 'video' ? document.createElement('video') : document.createElement('img');
  el.src = item.media.url;
  if (item.media.type === 'video') { el.muted = true; el.autoplay = true; el.loop = false; }
  stage.appendChild(el);
  requestAnimationFrame(() => el.classList.add('active'));

  timer = setTimeout(() => { idx++; renderStage(); }, (item.durationSeconds || 10) * 1000);
}

document.getElementById('pairBtn').addEventListener('click', () => {
  const code = document.getElementById('pairInput').value.trim().toUpperCase();
  if (!code) return;
  pairingCode = code;
  localStorage.setItem('sw_kiosk_pairing_code', code);
  document.getElementById('pairScreen').style.display = 'none';
  stage.style.display = 'block';
  fetchPlaylist();
  setInterval(fetchPlaylist, 60000); // playlist içerik değişikliklerini dakikada bir kontrol et
});

if (pairingCode) {
  document.getElementById('pairScreen').style.display = 'none';
  stage.style.display = 'block';
  fetchPlaylist();
  setInterval(fetchPlaylist, 60000);
}

// Tam ekran (dokunmatik kiosk cihazlarında ilk dokunuşta)
document.body.addEventListener('click', () => {
  if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}, { once: true });
