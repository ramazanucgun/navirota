const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function migrate() {
  console.log('Database migration başlıyor...');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL bulunamadı.');
  }

  const sqlPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('PostgreSQL bağlantısı başarılı.');

    await client.query(sql);

    console.log('Schema başarıyla uygulandı.');
  } finally {
    await client.end();
  }
}

migrate()
  .then(() => {
    console.log('Migration tamamlandı.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration hatası:', err);
    process.exit(1);
  });