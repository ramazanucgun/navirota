// backend/services/webhooks.js
//
// Olay-tabanlı webhook dağıtımı (PRD Bölüm 4 — "Queue" bileşeni).
// `REDIS_URL` tanımlıysa BullMQ kuyruğu üzerinden yeniden deneme
// (retry/exponential backoff) ile gönderilir (bkz. services/webhookQueue.js);
// tanımlı değilse eskisi gibi senkron+best-effort (tek deneme, hata
// yalnızca loglanır) gönderim yapılır — davranış geriye dönük uyumludur.

const crypto = require('crypto');
const { query } = require('../db/pool');
const { enqueueWebhookJob } = require('./webhookQueue');

function signPayload(secret, payload) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

/**
 * Tek bir webhook hedefine TEK BİR teslimat denemesi yapar ve sonucu
 * webhook_deliveries'e kaydeder. Hem senkron (kuyruksuz) yoldan hem de
 * BullMQ worker'ından (services/webhookQueue.js) çağrılan ortak çekirdek.
 * @returns {Promise<{success: boolean, statusCode: number|null}>}
 */
async function attemptDelivery(webhook, event, payload) {
  const signature = signPayload(webhook.secret, payload);
  let statusCode = null;
  let success = false;
  try {
    const res = await fetch(webhook.target_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SmartWay-Signature': signature },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    statusCode = res.status;
    success = res.ok;
  } catch {
    success = false;
  }
  await query(
    `INSERT INTO webhook_deliveries (webhook_id, event, payload, status_code, success)
     VALUES ($1,$2,$3,$4,$5)`,
    [webhook.id, event, JSON.stringify(payload), statusCode, success]
  ).catch(() => {});
  if (!success) {
    // BullMQ'nun bunu bir "başarısız deneme" olarak sayıp retry/backoff
    // uygulayabilmesi için hata fırlatılır (kuyruksuz modda bu hatayı
    // dispatchWebhookEvent zaten yutuyor, bkz. aşağıda).
    const err = new Error(`Webhook teslimatı başarısız (HTTP ${statusCode ?? 'ağ hatası'})`);
    err.statusCode = statusCode;
    throw err;
  }
  return { success, statusCode };
}

/**
 * @param {string} mallId
 * @param {string} event  örn. 'campaign.created', 'store.updated'
 * @param {object} data
 */
async function dispatchWebhookEvent(mallId, event, data) {
  try {
    const { rows: webhooks } = await query(
      `SELECT id, target_url, secret FROM webhooks
       WHERE mall_id = $1 AND is_active = true AND $2 = ANY(events)`,
      [mallId, event]
    );
    if (!webhooks.length) return;

    const payload = { event, data, timestamp: new Date().toISOString() };

    await Promise.all(webhooks.map(async (wh) => {
      const queued = await enqueueWebhookJob(wh, event, payload);
      if (queued) return; // BullMQ devraldı — retry/backoff worker'da olacak
      // Kuyruk yoksa (REDIS_URL tanımsız) eski senkron+best-effort davranış:
      // tek deneme, hata yalnızca yutulur (ana isteği asla etkilemez).
      await attemptDelivery(wh, event, payload).catch(() => {});
    }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[webhooks] dispatch hatası:', err.message);
  }
}

module.exports = { dispatchWebhookEvent, signPayload, attemptDelivery };
