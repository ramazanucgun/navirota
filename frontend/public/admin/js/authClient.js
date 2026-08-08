// frontend/public/admin/js/authClient.js
// Üç panelde de (AVM/Mağaza/Super Admin) ortak kullanılan giriş + istek yardımcıları.
'use strict';

const AdminAuth = (() => {
  const STORAGE_KEY = 'sw_admin_session';

  function getSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  }
  function setSession(session) { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); }
  function clearSession() { localStorage.removeItem(STORAGE_KEY); }

  async function login(email, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Giriş başarısız.');
    setSession(data);
    return data;
  }

  function logout() {
    const s = getSession();
    if (s?.refreshToken) {
      fetch('/api/auth/logout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: s.refreshToken }),
      }).catch(() => {});
    }
    clearSession();
  }

  /** Yetkili istek: Authorization header otomatik eklenir; 401'de refresh dener. */
  async function api(path, opts = {}) {
    const session = getSession();
    if (!session) throw new Error('Oturum yok.');

    const doFetch = (token) => fetch(path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts.headers || {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    let res = await doFetch(session.accessToken);
    if (res.status === 401 && session.refreshToken) {
      const r = await fetch('/api/auth/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (r.ok) {
        const { accessToken } = await r.json();
        setSession({ ...session, accessToken });
        res = await doFetch(accessToken);
      }
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `İstek başarısız (${res.status})`);
    return data;
  }

  /** Sayfayı korur: oturum yoksa ya da rol uygun değilse login ekranına döner. */
  function guard(allowedRoles) {
    const session = getSession();
    if (!session || !allowedRoles.includes(session.user.role)) {
      clearSession();
      return null;
    }
    return session;
  }

  return { getSession, setSession, clearSession, login, logout, api, guard };
})();

function toast(message, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
}
