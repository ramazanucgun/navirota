// backend/db/migrate.js
//
// Render (ücretsiz plan, Shell KAPALI) gibi ortamlarda migration'ları elle
// çalıştıramadığınız için bu script Build Command'a eklenip HER deploy'da
// otomatik çalışacak şekilde tasarlanmıştır.
//
// Güvenlidir (idempotent): schema.sql yalnızca veritabanı hiç kurulmamışsa
// bir kez uygulanır; schema_v2/v3/v4.sql dosyalarının tamamı `IF NOT EXISTS`
// / `ADD COLUMN IF NOT EXISTS` gibi korumalarla yazıldığından, zaten
// uygulanmış olsalar bile tekrar tekrar çalıştırılmaları güvenlidir ve
// hata vermez. Bu sayede her deploy'da otomatik çalıştırılabilir.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const PHASE_FILES = ['schema_v2.sql', 'schema_v3.sql', 'schema_v4.sql'];

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

    // Ana schema (Faz 1) daha önce kurulmuş mu?
    const check = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'plans'
      ) AS exists;
    `);

    if (!check.rows[0].exists) {
      const sqlPath = path.join(__dirname, 'schema.sql');
      const sql = fs.readFileSync(sqlPath, 'utf8');
      await client.query(sql);
      console.log('Ana schema (Faz 1) başarıyla uygulandı.');
    } else {
      console.log('Ana schema (Faz 1) zaten mevcut, yeniden uygulanmıyor.');
    }

    // Faz 2-3-4 eklentileri: hepsi IF NOT EXISTS korumalı, tekrar
    // çalıştırılmaları güvenlidir — bu yüzden koşulsuz her deploy'da uygulanır.
    for (const file of PHASE_FILES) {
      const filePath = path.join(__dirname, file);
      if (!fs.existsSync(filePath)) {
        console.log(`${file} bulunamadı, atlanıyor.`);
        continue;
      }
      const sql = fs.readFileSync(filePath, 'utf8');
      await client.query(sql);
      console.log(`${file} uygulandı (ya da zaten günceldi).`);
    }

    console.log('Tüm migration adımları tamamlandı.');
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
