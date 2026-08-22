// backend/services/rateLimitStore.js
//
// express-rate-limit varsayılan olarak process-içi (in-memory) bir sayaç
// kullanır — bu, birden fazla Node process/instance yük dengeleyici
// arkasında koşarken TUTARSIZLAŞIR (her instance kendi sayacını tutar,
// dolayısıyla gerçek limit instance sayısıyla orantılı olarak gevşer).
// REDIS_URL tanımlıysa paylaşılan bir Redis store'a geçilir; tanımlı
// değilse (tek instance / yerel geliştirme) in-memory'e (varsayılan davranış,
// `undefined` store) sorunsuzca düşer.

const { RedisStore } = require('rate-limit-redis');
const { createClient } = require('redis');

let redisClient = null;
let lastFailureAt = 0;
const FAILURE_COOLDOWN_MS = 15000; // bağlantı başarısız olduktan sonra 15sn boyunca tekrar denenmez

async function getRedisClient() {
  if (!process.env.REDIS_URL) return null;
  if (redisClient) return redisClient;

  // Devre kesici: son bağlantı denemesi yakın zamanda başarısız olduysa,
  // her isteğin yeni bir TCP bağlantı denemesi (connectTimeout kadar
  // bekleyerek) başlatmasını ÖNLER. Bu olmadan, Redis kesintide iken
  // GELEN HER İSTEK birkaç saniye bloklanırdı — bu, "Redis yoksa
  // in-memory'e sorunsuzca düş" hedefinin tam tersi bir davranış olurdu.
  if (Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS) return null;

  redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: {
      connectTimeout: 2000,
      reconnectStrategy: false, // otomatik yeniden bağlanma yok — devre kesici bunun yerini alır
    },
  });
  redisClient.on('error', () => {}); // 'error' event'i dinlenmezse Node process'i çökertir; sessizce yut, gerçek hata aşağıda ele alınıyor
  try {
    await redisClient.connect();
    return redisClient;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[redis] bağlantı başarısız, ${FAILURE_COOLDOWN_MS / 1000}sn boyunca tekrar denenmeyecek:`, err.message);
    redisClient = null;
    lastFailureAt = Date.now();
    return null;
  }
}

/**
 * express-rate-limit `store` seçeneği için kullanılacak nesneyi döner.
 * REDIS_URL yoksa `undefined` döner (express-rate-limit bu durumda kendi
 * varsayılan in-memory store'unu kullanır — davranış DEĞİŞMEZ).
 *
 * DAYANIKLILIK: express-rate-limit, store'un `increment()` metodu hata
 * fırlatırsa bunu Express'in genel hata yakalayıcısına iletir (yani
 * TÜM istekler 500 döner) — Redis geçici olarak erişilemez olduğunda bu,
 * rate-limit'i AŞMAK yerine TÜM API'yi kilitlemek anlamına gelirdi. Bu,
 * "Redis yoksa sorunsuzca düş" hedefinin tam tersidir. Bu yüzden burada
 * RedisStore, hataları YUTAN ve bu durumda isteğin geçmesine izin veren
 * (fail-open — rate-limit geçici olarak devre dışı kalır ama API çalışmaya
 * devam eder) ince bir sarmalayıcıyla (wrapper) kullanılıyor.
 */
function createRateLimitStore(prefix) {
  if (!process.env.REDIS_URL) return undefined;

  const store = new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: async (...args) => {
      const client = await getRedisClient();
      if (!client) throw new Error('redis_unavailable'); // increment()'te yakalanacak
      return client.sendCommand(args);
    },
  });
  // RedisStore'un constructor'ı iki LUA script'ini EAGERLY (await edilmeden,
  // "fire and forget" olarak) yükler (bkz. rate-limit-redis kaynağı:
  // `this.incrementScriptSha = this.loadIncrementScript()`). Redis
  // erişilemezse bu promise'ler burada yakalanmazsa unhandledRejection
  // üretir — increment()/decrement() sarmalayıcılarımız yalnızca SONRAKİ
  // çağrıları kapsar, bu ilk (constructor-zamanlı) çağrıları kapsamaz.
  store.incrementScriptSha?.catch(() => {});
  store.getScriptSha?.catch(() => {});

  const FAR_FUTURE = () => new Date(Date.now() + 60 * 60 * 1000);
  return {
    // GÜVENLİK/DOĞRULUK NOTU: `{ ...store }` (object spread) burada
    // KULLANILAMAZ — RedisStore'un `init()` metodu class prototype'ında
    // tanımlı, spread yalnızca "own enumerable" property'leri kopyalar,
    // prototype metotlarını DEĞİL. Bu, express-rate-limit'in middleware
    // kurulumunda çağırdığı `store.init({ windowMs })`'in sessizce hiçbir
    // şey yapmamasına (dolayısıyla `this.windowMs` hep `undefined` kalıp
    // her increment() çağrısının İÇTEN İÇE hata verip fail-open'a
    // düşmesine — yani rate-limit'in Redis ÇALIŞIRKEN bile hiç iş
    // yapmamasına) yol açardı. Bu hata gerçek bir sunucuya karşı elle
    // test edilirken (Redis çalışırken bile sayaç hiç artmıyordu) bulundu.
    init: (options) => store.init(options),
    async increment(key) {
      try {
        return await store.increment(key);
      } catch {
        return { totalHits: 1, resetTime: FAR_FUTURE() }; // fail-open: limitlenmemiş say
      }
    },
    async decrement(key) {
      try { await store.decrement(key); } catch { /* no-op */ }
    },
    async resetKey(key) {
      try { await store.resetKey(key); } catch { /* no-op */ }
    },
  };
}

module.exports = { createRateLimitStore };
