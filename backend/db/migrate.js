const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function migrate() {
  console.log('Database migration başlıyor...');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL bulunamadı.');
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('PostgreSQL bağlantısı başarılı.');

    // Veritabanının daha önce kurulup kurulmadığını kontrol et
    const check = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'plans'
      ) AS exists;
    `);

    // Yeni veritabanıysa schema.sql'i uygula
    if (!check.rows[0].exists) {
      const sqlPath = path.join(__dirname, 'schema.sql');
      const sql = fs.readFileSync(sqlPath, 'utf8');

      await client.query(sql);

      console.log('Schema başarıyla uygulandı.');
    } else {
      console.log('Mevcut veritabanı tespit edildi.');
      console.log('Ana schema zaten mevcut, tekrar uygulanmıyor.');
    }

    // Auth sistemi için gerekli refresh_tokens tablosunu kontrol et
    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user
      ON refresh_tokens(user_id);
    `);

    console.log('refresh_tokens tablosu kontrol edildi.');
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