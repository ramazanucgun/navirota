// backend/routes/billing/callback.js
//
// iyzico Checkout Form akışı tamamlandığında kullanıcının tarayıcısı bu
// uç noktaya (callbackUrl) yönlendirilir/form-POST eder — bu yüzden bu
// route KİMLİK DOĞRULAMASIZ ve CORS-kısıtsız olmak ZORUNDADIR (iyzico'nun
// kendi sayfasından gelen bir top-level form POST'tur, bizim JWT'imiz ya
// da ALLOWED_ORIGINS allow-list'imiz burada uygulanamaz).
//
// GÜVENLİK: İstemciden (tarayıcıdan) gelen "başarılı" iddiasına ASLA
// güvenilmez. `token` alınır alınmaz iyzico'ya SUNUCU-SUNUCU tekrar
// sorgulanır (retrieveCheckoutForm) ve invoice/mall güncellemesi yalnızca
// bu doğrulanmış sonuca göre yapılır.

const express = require('express');
const { query, withTransaction } = require('../../db/pool');
const { retrieveCheckoutForm } = require('../../services/iyzico');
const { recordAudit } = require('../../services/auditLog');

const router = express.Router();

async function handleCallback(req, res) {
  const token = req.body?.token || req.query?.token;
  const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
  const failRedirect = `${baseUrl}/admin/billing-result.html?status=failed`;

  if (!token) return res.redirect(302, failRedirect);

  try {
    const result = await retrieveCheckoutForm(token);
    const invoiceRes = await query(
      `SELECT i.id, i.mall_id, i.plan_id, i.period_end, i.status
       FROM invoices i WHERE i.checkout_token = $1`,
      [token]
    );
    const invoice = invoiceRes.rows[0];
    if (!invoice) return res.redirect(302, failRedirect);

    if (invoice.status === 'paid') {
      // Zaten işlenmiş (iyzico bazen callback'i birden fazla kez tetikleyebilir) — idempotent.
      return res.redirect(302, `${baseUrl}/admin/billing-result.html?status=success`);
    }

    const isSuccess = result.status === 'success' && result.paymentStatus === 'SUCCESS';
    if (!isSuccess) {
      await query(
        `UPDATE invoices SET status = 'failed', failure_reason = $2 WHERE id = $1`,
        [invoice.id, result.errorMessage || 'Ödeme başarısız.']
      );
      return res.redirect(302, failRedirect);
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE invoices SET status = 'paid', paid_at = now(), provider_payment_id = $2 WHERE id = $1`,
        [invoice.id, result.paymentId || null]
      );
      await client.query(
        `UPDATE malls SET plan_id = $2, status = 'active', current_period_end = $3, updated_at = now() WHERE id = $1`,
        [invoice.mall_id, invoice.plan_id, invoice.period_end]
      );
    });

    await recordAudit({
      req: { user: { id: null, role: null }, mall: { id: invoice.mall_id }, ip: req.ip },
      entity: 'invoice', entityId: invoice.id, action: 'payment_succeeded',
    });

    return res.redirect(302, `${baseUrl}/admin/billing-result.html?status=success`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[billing/callback] hata:', err);
    return res.redirect(302, failRedirect);
  }
}

router.post('/iyzico/callback', express.urlencoded({ extended: false }), handleCallback);
router.get('/iyzico/callback', handleCallback);

module.exports = router;
