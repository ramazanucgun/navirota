const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: parseInt(process.env.PG_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000
});

pool.on('error', (err) => {
  console.error('[db] beklenmeyen havuz hatası', err);
});

async function query(text, params = []) {
  const start = Date.now();
  const res = await pool.query(text, params);

  if (process.env.NODE_ENV !== 'production') {
    const ms = Date.now() - start;
    console.log(`[db] ${ms}ms ${text.split('\n')[0].slice(0, 80)}`);
  }

  return res;
}

// NOT: readQuery, routes/admin/analytics.js gibi dosyalarda kullanılıyor.
// Şu an ayrı bir okuma replikası (read replica) yok; bu yüzden query'nin
// birebir aynısına yönlendirilir. İleride bir replika eklenirse yalnızca
// burası değişir, çağıran kodun hiçbiri değişmez.
const readQuery = query;

/**
 * Birden fazla yazmanın hep birlikte başarılı ya da hep birlikte geri
 * alınması gereken yerlerde kullanılır (bkz. routes/superadmin/index.js'te
 * elle yazılmış BEGIN/COMMIT/ROLLBACK deseni — burada tekrar kullanılabilir
 * bir yardımcıya çıkarıldı).
 *
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, readQuery, withTransaction };