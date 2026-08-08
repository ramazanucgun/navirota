// backend/db/pool.js
// Tek bir PostgreSQL bağlantı havuzu. Multi-tenant izolasyon uygulama
// katmanında (her sorguda mall_id filtresi) sağlanır; bu, tek dağıtımla
// yüzlerce AVM'ye hizmet vermeyi maliyet-etkin şekilde mümkün kılar.

const { Pool } = require('pg');

const primaryConfig = {
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'smartway',
  password: process.env.PGPASSWORD || 'smartway',
  database: process.env.PGDATABASE || 'smartway_avm',
  max: parseInt(process.env.PG_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000,
};

const pool = new Pool(primaryConfig);

// --- Okuma replikası (Faz 4 — PRD Bölüm 14 ölçeklenebilirlik hazırlığı) ---
// PG_READ_REPLICA_HOST tanımlıysa, salt-okunur/ağır analitik sorguları
// ayrı bir havuza yönlendirilir; tanımlı değilse aynı birincil havuza
// düşer (replicaQuery === query), yani bu özellik olmadan da sistem
// normal çalışır — yalnızca ölçek büyüdüğünde devreye giren bir anahtar.
const hasReadReplica = !!process.env.PG_READ_REPLICA_HOST;
const readPool = hasReadReplica
  ? new Pool({ ...primaryConfig, host: process.env.PG_READ_REPLICA_HOST, port: process.env.PG_READ_REPLICA_PORT || primaryConfig.port })
  : pool;

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] beklenmeyen havuz hatası', err);
});
if (hasReadReplica) {
  readPool.on('error', (err) => console.error('[db:replica] beklenmeyen havuz hatası', err));
}

/**
 * Yazma + tutarlı-okuma sorguları için: her zaman birincil (primary) havuzu kullanır.
 */
async function query(text, params = []) {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (process.env.NODE_ENV !== 'production') {
    const ms = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(`[db] ${ms}ms  ${text.split('\n')[0].slice(0, 80)}`);
  }
  return res;
}

/**
 * Gecikmeye toleranslı, ağır okuma sorguları için (örn. analitik/rapor
 * uç noktaları): replika tanımlıysa oraya, değilse birincile gider.
 */
async function readQuery(text, params = []) {
  const res = await readPool.query(text, params);
  return res;
}

module.exports = { pool, readPool, query, readQuery, hasReadReplica };
