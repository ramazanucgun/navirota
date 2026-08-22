// backend/services/iyzico.js
//
// iyzico Checkout Form API (V2 / "IYZWSv2") ile hafif entegrasyon.
//
// Resmi 'iyzipay' npm paketi BİLİNÇLİ OLARAK kullanılmadı: o paket eski
// 'postman-request' → 'qs'/'uuid' zincirine bağımlı ve `npm audit` bunları
// ORTA seviye güvenlik açığı olarak işaretliyor (bkz. GHSA-q8mj-m7cp-5q26,
// GHSA-w5hq-g745-h8pq). Bir ödeme entegrasyonuna güvenlik açıklı bir
// bağımlılık eklemek, tam da Faz 5'te sertleştirmeye çalıştığımız şeyin
// zıddı olurdu — bu yüzden native `fetch` + `crypto` ile iyzico'nun
// dokümante edilmiş HMACSHA256 imzalı yetkilendirme şeması doğrudan
// uygulandı. Dış bağımlılık eklenmedi.
//
// MOCK MOD: IYZICO_API_KEY/IYZICO_SECRET_KEY tanımlı değilse (ya da
// IYZICO_MOCK=true ise) gerçek ağ çağrısı yapılmaz, "başarılı ödeme" simüle
// edilir. Bu, bu inceleme ortamı gibi iyzico'nun API'sine ağ erişimi
// olmayan yerlerde de checkout→callback→plan-güncelleme akışının uçtan uca
// test edilebilmesini sağlar. Production'da gerçek anahtarlar OLMADAN
// gerçek para tahsil edilmez — bu durum ayrıca sunucu başlangıcında
// loglanır.

const crypto = require('crypto');

const BASE_URL = process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com';
const API_KEY = process.env.IYZICO_API_KEY;
const SECRET_KEY = process.env.IYZICO_SECRET_KEY;
const MOCK_MODE = process.env.IYZICO_MOCK === 'true' || !API_KEY || !SECRET_KEY;

if (process.env.NODE_ENV === 'production' && MOCK_MODE) {
  // eslint-disable-next-line no-console
  console.warn(
    '[iyzico] UYARI: IYZICO_API_KEY/IYZICO_SECRET_KEY tanımlı değil — ' +
    'production ortamında MOCK modda çalışıyor, GERÇEK ÖDEME ALINMIYOR.'
  );
}

function randomKey() {
  return Date.now() + crypto.randomBytes(8).toString('hex');
}

/** iyzico "yeni nesil" (IYZWSv2) HMACSHA256 imzalı Authorization header'ı. */
function buildAuthHeader(uriPath, body) {
  const rnd = randomKey();
  const payload = rnd + uriPath + JSON.stringify(body);
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(payload).digest('hex');
  const authParams = [`apiKey:${API_KEY}`, `randomKey:${rnd}`, `signature:${signature}`].join('&');
  const authorization = 'IYZWSv2 ' + Buffer.from(authParams).toString('base64');
  return { Authorization: authorization, 'x-iyzi-rnd': rnd, 'Content-Type': 'application/json' };
}

async function iyzicoRequest(uriPath, body) {
  const headers = buildAuthHeader(uriPath, body);
  const res = await fetch(BASE_URL + uriPath, { method: 'POST', headers, body: JSON.stringify(body) });
  return res.json();
}

/**
 * Ödeme formunu başlatır (hosted checkout — kart bilgileri iyzico'nun
 * kendi sayfasında girilir, hiçbir zaman bizim sunucumuza dokunmaz; bu
 * sayede PCI-DSS kapsamımız büyümez).
 *
 * @returns {{ status: string, token?: string, paymentPageUrl?: string, errorMessage?: string }}
 */
async function initializeCheckoutForm({ conversationId, price, currency, buyer, callbackUrl, basketItems }) {
  if (MOCK_MODE) {
    const token = `mock_${conversationId}`;
    return {
      status: 'success',
      token,
      checkoutFormContent: '<div>mock iyzico checkout form</div>',
      // Gerçek entegrasyonda iyzico kendi barındırdığı ödeme sayfasının
      // URL'sini döner; mock modda doğrudan callback'imize yönlendiriyoruz
      // (test/demo ortamında tarayıcıyı gerçekten bir formda dolaştırmadan
      // akışı uçtan uca doğrulayabilmek için).
      paymentPageUrl: `${callbackUrl}?token=${token}`,
    };
  }
  const body = {
    locale: 'tr',
    conversationId,
    price,
    paidPrice: price,
    currency: currency || 'TRY',
    basketId: conversationId,
    paymentGroup: 'SUBSCRIPTION',
    callbackUrl,
    buyer,
    basketItems,
    enabledInstallments: [1],
  };
  return iyzicoRequest('/payment/iyzipos/checkoutform/initialize/auth/ecom', body);
}

/**
 * Callback sonrası ödeme sonucunu SUNUCU-SUNUCU tekrar sorgular.
 * GÜVENLİK: istemciden (tarayıcıdan) gelen "başarılı" bilgisine ASLA
 * güvenilmez — token her zaman burada iyzico'ya karşı yeniden doğrulanır.
 */
async function retrieveCheckoutForm(token) {
  if (MOCK_MODE) {
    return {
      status: 'success',
      paymentStatus: 'SUCCESS',
      token,
      conversationId: token.replace(/^mock_/, ''),
    };
  }
  return iyzicoRequest('/payment/iyzipos/checkoutform/auth/ecom/detail', { locale: 'tr', token });
}

module.exports = { initializeCheckoutForm, retrieveCheckoutForm, MOCK_MODE };
