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

module.exports = { pool, query };