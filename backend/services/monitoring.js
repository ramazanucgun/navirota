// backend/services/monitoring.js
//
// Sentry hata izleme entegrasyonu. SENTRY_DSN tanımlı değilse tüm
// fonksiyonlar no-op'tur — yerel geliştirmede ya da bu inceleme ortamında
// (sentry.io'ya ağ erişimi olmayan sandbox dahil) uygulama hiçbir şekilde
// etkilenmez, sadece hatalar Sentry'ye raporlanmaz.

const Sentry = require('@sentry/node');

const DSN = process.env.SENTRY_DSN;
const ENABLED = Boolean(DSN);

function init() {
  if (!ENABLED) {
    if (process.env.NODE_ENV === 'production') {
      // eslint-disable-next-line no-console
      console.warn('[monitoring] UYARI: SENTRY_DSN tanımlı değil — production hataları Sentry\'ye raporlanmayacak, yalnızca sunucu loglarında görünecek.');
    }
    return;
  }
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
  });
}

/** Beklenmeyen (5xx) hataları Sentry'ye gönderir. 4xx doğrulama hataları bilinçli/beklenen olduğundan gönderilmez — gürültü azaltma. */
function captureError(err) {
  if (!ENABLED) return;
  const status = err.status || 500;
  if (status >= 500) Sentry.captureException(err);
}

module.exports = { init, captureError, ENABLED };
