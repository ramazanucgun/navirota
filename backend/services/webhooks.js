// backend/services/webhooks.js
//
// Olay-tabanlı webhook dağıtımı (PRD Bölüm 4 — "Queue" bileşeni). MVP
// kapsamında senkron+best-effort gönderim yapılır (ana isteği bloklamaz,
// hata durumunda yalnızca loglanır); Faz 5+'ta BullMQ kuyruğuna taşınarak
// yeniden deneme (retry/backoff) eklenmesi planlanır — arayüz (imza, payload
// şekli) bu geçişten etkilenmeyecek şekilde tasarlandı.

const crypto = require('crypto');
const { query } = require('../db/pool');

function signPayload(secret, payload) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
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
      const signature = signPayload(wh.secret, payload);
      let statusCode = null;
      let success = false;
      try {
        const res = await fetch(wh.target_url, {
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
      query(
        `INSERT INTO webhook_deliveries (webhook_id, event, payload, status_code, success)
         VALUES ($1,$2,$3,$4,$5)`,
        [wh.id, event, JSON.stringify(payload), statusCode, success]
      ).catch(() => {});
    }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[webhooks] dispatch hatası:', err.message);
  }
}

module.exports = { dispatchWebhookEvent, signPayload };
