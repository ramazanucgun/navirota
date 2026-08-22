// frontend/public/admin/js/reset-password.js
'use strict';

const requestStep = document.getElementById('requestStep');
const resetStep = document.getElementById('resetStep');
const params = new URLSearchParams(location.search);
const token = params.get('token');

if (token) {
  requestStep.hidden = true;
  resetStep.hidden = false;
} else {
  requestStep.hidden = false;
  resetStep.hidden = true;
}

document.getElementById('requestForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('requestError');
  const successEl = document.getElementById('requestSuccess');
  errorEl.hidden = true;
  successEl.hidden = true;
  const email = document.getElementById('requestEmail').value.trim();
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'İstek başarısız.');
    successEl.textContent = data.message || 'Bu e-posta sistemde kayıtlıysa, parola sıfırlama bağlantısı gönderildi.';
    successEl.hidden = false;
    document.getElementById('requestForm').reset();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

document.getElementById('resetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('resetError');
  const successEl = document.getElementById('resetSuccess');
  errorEl.hidden = true;
  successEl.hidden = true;

  const newPassword = document.getElementById('newPassword').value;
  const newPasswordConfirm = document.getElementById('newPasswordConfirm').value;
  if (newPassword !== newPasswordConfirm) {
    errorEl.textContent = 'Girdiğiniz parolalar eşleşmiyor.';
    errorEl.hidden = false;
    return;
  }

  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Parola güncellenemedi.');
    successEl.textContent = data.message || 'Parolanız güncellendi. Lütfen yeniden giriş yapın.';
    successEl.hidden = false;
    document.getElementById('resetForm').hidden = true;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});
