// backend/services/webhookQueue.js
//
// REDIS_URL tanımlıysa webhook teslimatlarını BullMQ kuyruğuna alır ve
// başarısız denemeleri exponential backoff ile yeniden dener (5 deneme:
// ~2s, 4s, 8s, 16s, 32s aralıklarla). Tanımlı değilse `enqueueWebhookJob`
// `false` döner — çağıran taraf (services/webhooks.js) o zaman eski
// senkron+tek-denemelik davranışa geri döner. Bu modül import edildiğinde
// REDIS_URL yoksa hiçbir bağlantı denemesi YAPMAZ (iyzico/SMTP modüllerinde
// kurulan "altyapı yoksa no-op" deseniyle tutarlı).

const REDIS_URL = process.env.REDIS_URL;
let queue = null;
let worker = null;
let queueSetupFailed = false;

function getQueue() {
  if (!REDIS_URL) return null;
  if (queue) return queue;
  if (queueSetupFailed) return null; // kurulum daha önce başarısız oldu, tekrar deneme

  try {
    // Lazy require: bullmq/ioredis, REDIS_URL hiç tanımlı değilse yüklenmesin
    // diye yalnızca gerçekten gerektiğinde import edilir.
    const { Queue, Worker } = require('bullmq');
    const connection = { url: REDIS_URL, maxRetriesPerRequest: null }; // BullMQ Worker'ın gerektirdiği ayar

    queue = new Queue('webhook-delivery', { connection });

    const { attemptDelivery } = require('./webhooks');
    worker = new Worker(
      'webhook-delivery',
      async (job) => {
        const { webhook, event, payload } = job.data;
        await attemptDelivery(webhook, event, payload); // başarısızsa fırlatır → BullMQ retry'ı tetikler
      },
      { connection, concurrency: 5 }
    );
    worker.on('failed', (job, err) => {
      // eslint-disable-next-line no-console
      console.error(`[webhookQueue] deneme ${job.attemptsMade}/${job.opts.attempts} başarısız (webhook=${job.data.webhook.id}):`, err.message);
    });
    worker.on('error', (err) => {
      // BullMQ Worker'ın kendi iç bağlantı hatalarını da yut — aksi halde
      // bunlar unhandled event-emitter hatası olarak process'i çökertebilir.
      // eslint-disable-next-line no-console
      console.error('[webhookQueue] worker hatası:', err.message);
    });

    return queue;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[webhookQueue] kuyruk kurulamadı, senkron gönderime düşülüyor:', err.message);
    queueSetupFailed = true;
    queue = null;
    return null;
  }
}

/**
 * @returns {Promise<boolean>} true → kuyruğa alındı (retry worker'da olacak); false → kuyruk yok, çağıran taraf senkron denemeli
 */
async function enqueueWebhookJob(webhook, event, payload) {
  const q = getQueue();
  if (!q) return false;
  await q.add(
    'deliver',
    { webhook, event, payload },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600 }, // tamamlanan job'lar 1 saat sonra temizlenir
      removeOnFail: { age: 86400 }, // başarısız job'lar (inceleme için) 24 saat tutulur
    }
  );
  return true;
}

/** Test/graceful-shutdown için: worker ve kuyruk bağlantılarını kapatır. */
async function closeWebhookQueue() {
  if (worker) await worker.close();
  if (queue) await queue.close();
}

module.exports = { enqueueWebhookJob, closeWebhookQueue };
