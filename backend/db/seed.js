// backend/db/seed.js
// Demo amaçlı: "Terrace AVM" adında tek bir mall, 2 kat, ~8 mağaza,
// aralarında koridor node/edge grafiği ve birkaç kampanya oluşturur.
// Çalıştırma: node db/seed.js  (DATABASE_URL / PG* env değişkenleri gerekir)
//
// İDEMPOTENT: Bu script, Shell erişimi olmayan ortamlarda (örn. Render
// ücretsiz plan) Build Command'a eklenip her deploy'da güvenle tekrar
// çalıştırılabilecek şekilde yazılmıştır — var olan kayıtları çoğaltmaz.

require('dotenv').config();
const { query, pool } = require('./pool');

async function seed() {
  console.log('Seed başlıyor...');

  const plan = await query(
    `INSERT INTO plans (code, name, max_stores, max_floors, monthly_price, features)
     VALUES ('pro', 'Pro Paket', 200, 10, 4999,
       '{"ai_search": true, "heatmap": true, "multi_admin": true}')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const planId = plan.rows[0].id;

  await query(
    `INSERT INTO plans (code, name, max_stores, max_floors, monthly_price, features)
     VALUES ('starter', 'Starter Paket', 50, 3, 1999, '{"ai_search": false, "heatmap": false}')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`
  );
  await query(
    `INSERT INTO plans (code, name, max_stores, max_floors, monthly_price, features)
     VALUES ('enterprise', 'Enterprise Paket', 1000, 30, 12999, '{"ai_search": true, "heatmap": true, "multi_admin": true, "digital_signage": true}')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`
  );

  const mall = await query(
    `INSERT INTO malls (slug, name, city, plan_id, status)
     VALUES ('terrace', 'Terrace AVM', 'İstanbul', $1, 'active')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [planId]
  );
  const mallId = mall.rows[0].id;

  const floor0 = await query(
    `INSERT INTO floors (mall_id, level_index, label, viewbox)
     VALUES ($1, 0, 'Zemin Kat', '0 0 1000 600')
     ON CONFLICT (mall_id, level_index) DO UPDATE SET label = EXCLUDED.label
     RETURNING id`,
    [mallId]
  );
  const floor1 = await query(
    `INSERT INTO floors (mall_id, level_index, label, viewbox)
     VALUES ($1, 1, '1. Kat', '0 0 1000 600')
     ON CONFLICT (mall_id, level_index) DO UPDATE SET label = EXCLUDED.label
     RETURNING id`,
    [mallId]
  );
  const floor0Id = floor0.rows[0].id;
  const floor1Id = floor1.rows[0].id;

  // ---- Kat 0 düğümleri: QR giriş noktası -> koridor -> asansör -> mağaza girişleri
  const nodeDefs0 = [
    ['K0-A-05', 'corridor', 80, 300],
    ['K0-C1', 'corridor', 250, 300],
    ['K0-C2', 'corridor', 450, 300],
    ['K0-C3', 'corridor', 650, 300],
    ['K0-ELV', 'elevator', 650, 150],
    ['K0-STORE-LCW', 'store_entrance', 450, 200],
    ['K0-STORE-ZARA', 'store_entrance', 650, 450],
    ['K0-STORE-STARBUCKS', 'store_entrance', 250, 450],
  ];
  const nodeDefs1 = [
    ['K1-ELV', 'elevator', 650, 150],
    ['K1-C1', 'corridor', 650, 300],
    ['K1-C2', 'corridor', 450, 300],
    ['K1-STORE-MEDIAMARKT', 'store_entrance', 450, 200],
    ['K1-STORE-MANGO', 'store_entrance', 250, 300],
  ];

  const idMap = {};
  for (const [code, type, x, y] of nodeDefs0) {
    const r = await query(
      `INSERT INTO nav_nodes (floor_id, code, node_type, x, y, linked_group)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (floor_id, code) DO UPDATE SET x = EXCLUDED.x RETURNING id`,
      [floor0Id, code, type, x, y, code.includes('ELV') ? 'ELV-1' : null]
    );
    idMap[code] = r.rows[0].id;
  }
  for (const [code, type, x, y] of nodeDefs1) {
    const r = await query(
      `INSERT INTO nav_nodes (floor_id, code, node_type, x, y, linked_group)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (floor_id, code) DO UPDATE SET x = EXCLUDED.x RETURNING id`,
      [floor1Id, code, type, x, y, code.includes('ELV') ? 'ELV-1' : null]
    );
    idMap[code] = r.rows[0].id;
  }

  const edgeDefs = [
    ['K0-A-05', 'K0-C1', 1], ['K0-C1', 'K0-C2', 1], ['K0-C2', 'K0-C3', 1],
    ['K0-C2', 'K0-STORE-LCW', 1], ['K0-C1', 'K0-STORE-STARBUCKS', 1],
    ['K0-C3', 'K0-STORE-ZARA', 1], ['K0-C3', 'K0-ELV', 1],
    ['K0-ELV', 'K1-ELV', 4, 'elevator'],
    ['K1-ELV', 'K1-C1', 1], ['K1-C1', 'K1-C2', 1],
    ['K1-C2', 'K1-STORE-MEDIAMARKT', 1], ['K1-C2', 'K1-STORE-MANGO', 1],
  ];
  for (const [from, to, weight, edgeType] of edgeDefs) {
    // Bu script Build Command üzerinden her deploy'da çalışabileceğinden,
    // aynı kenarın tekrar tekrar eklenmemesi için önce varlığı kontrol edilir.
    const exists = await query(
      `SELECT 1 FROM nav_edges WHERE from_node_id = $1 AND to_node_id = $2`,
      [idMap[from], idMap[to]]
    );
    if (exists.rows.length) continue;
    await query(
      `INSERT INTO nav_edges (from_node_id, to_node_id, weight, edge_type, bidirectional)
       VALUES ($1, $2, $3, $4, true)`,
      [idMap[from], idMap[to], weight, edgeType || 'walk']
    );
  }

  await query(
    `INSERT INTO qr_codes (mall_id, node_id, code, label)
     VALUES ($1, $2, 'K0-A-05', 'Ana Giriş - Koridor A')
     ON CONFLICT (code) DO NOTHING`,
    [mallId, idMap['K0-A-05']]
  );

  const categories = [
    ['kadin', 'Kadın', 'Women'], ['erkek', 'Erkek', 'Men'],
    ['ayakkabi', 'Ayakkabı', 'Shoes'], ['elektronik', 'Elektronik', 'Electronics'],
    ['yemek', 'Yemek & İçecek', 'Food & Drink'],
  ];
  const catIds = {};
  for (const [code, tr, en] of categories) {
    const r = await query(
      `INSERT INTO categories (code, name_tr, name_en) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO UPDATE SET name_tr = EXCLUDED.name_tr RETURNING id`,
      [code, tr, en]
    );
    catIds[code] = r.rows[0].id;
  }

  const stores = [
    ['LC Waikiki', 'lc-waikiki', floor0Id, 'K0-STORE-LCW', 'kadin'],
    ['Zara', 'zara', floor0Id, 'K0-STORE-ZARA', 'kadin'],
    ['Starbucks', 'starbucks', floor0Id, 'K0-STORE-STARBUCKS', 'yemek'],
    ['MediaMarkt', 'mediamarkt', floor1Id, 'K1-STORE-MEDIAMARKT', 'elektronik'],
    ['Mango', 'mango', floor1Id, 'K1-STORE-MANGO', 'kadin'],
  ];
  const storeIds = {};
  for (const [name, slug, floorId, nodeCode, catCode] of stores) {
    const r = await query(
      `INSERT INTO stores (mall_id, floor_id, entrance_node_id, name, slug, unit_no)
       VALUES ($1,$2,$3,$4,$5,'—')
       ON CONFLICT (mall_id, slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [mallId, floorId, idMap[nodeCode], name, slug]
    );
    storeIds[slug] = r.rows[0].id;
    await query(
      `INSERT INTO store_categories (store_id, category_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [r.rows[0].id, catIds[catCode]]
    );
  }

  // Bu iki kampanya da Build Command üzerinden tekrar tekrar çalıştırılabileceğinden
  // (Shell kapalıyken migration/seed'i güncel tutmanın tek yolu budur), aynı
  // başlıkla ikinci kez eklenmesini önlemek için önce varlık kontrolü yapılır.
  const lcwCampaignExists = await query(
    `SELECT 1 FROM campaigns WHERE store_id = $1 AND title = 'Sezon Sonu İndirimi'`,
    [storeIds['lc-waikiki']]
  );
  if (!lcwCampaignExists.rows.length) {
    await query(
      `INSERT INTO campaigns (store_id, title, discount_percent, badge, starts_at, ends_at)
       VALUES ($1, 'Sezon Sonu İndirimi', 50, 'indirim', now() - interval '1 day', now() + interval '30 day')`,
      [storeIds['lc-waikiki']]
    );
  }
  const sbxCampaignExists = await query(
    `SELECT 1 FROM campaigns WHERE store_id = $1 AND title = '2. Kahve Hediye'`,
    [storeIds['starbucks']]
  );
  if (!sbxCampaignExists.rows.length) {
    await query(
      `INSERT INTO campaigns (store_id, title, badge, starts_at, ends_at)
       VALUES ($1, '2. Kahve Hediye', 'hediye', now() - interval '1 day', now() + interval '30 day')`,
      [storeIds['starbucks']]
    );
  }

  console.log('Seed tamamlandı. Mall slug: terrace | Demo QR: K0-A-05');

  // ---- Reklam envanteri tipleri (ad_slots) ----
  const slots = [
    ['home_top', 'Ana Sayfa Üst Banner'],
    ['search_inline', 'Arama Sonucu İçi (Sponsorlu)'],
    ['map_banner', 'Harita Alt Banner'],
    ['store_detail', 'Mağaza Detay Sayfası'],
    ['campaign_page', 'Kampanya Sayfası'],
    ['route_complete', 'Rota Tamamlandı Ekranı'],
    ['exit_screen', 'QR Çıkış Ekranı'],
  ];
  for (const [code, name] of slots) {
    await query(
      `INSERT INTO ad_slots (code, name) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING`,
      [code, name]
    );
  }

  // ---- Demo kullanıcılar (Faz 2: Auth/RBAC) ----
  const { hashPassword } = require('../services/auth');
  const superAdminHash = await hashPassword('SuperAdmin123!');
  const mallAdminHash = await hashPassword('MallAdmin123!');
  const storeManagerHash = await hashPassword('StoreManager123!');

  await query(
    `INSERT INTO users (mall_id, email, password_hash, full_name, role)
     VALUES (NULL, 'super@smartwayavm.com', $1, 'SmartWay Platform Ekibi', 'super_admin')
     ON CONFLICT (email) DO NOTHING`,
    [superAdminHash]
  );
  await query(
    `INSERT INTO users (mall_id, email, password_hash, full_name, role)
     VALUES ($1, 'admin@terrace-avm.com', $2, 'Terrace AVM Yönetimi', 'mall_admin')
     ON CONFLICT (email) DO NOTHING`,
    [mallId, mallAdminHash]
  );
  await query(
    `INSERT INTO users (mall_id, store_id, email, password_hash, full_name, role)
     VALUES ($1, $2, 'lcwaikiki@terrace-avm.com', $3, 'LC Waikiki Mağaza Yöneticisi', 'store_manager')
     ON CONFLICT (email) DO NOTHING`,
    [mallId, storeIds['lc-waikiki'], storeManagerHash]
  );

  console.log('Demo kullanıcılar:');
  console.log('  Super Admin   → super@smartwayavm.com / SuperAdmin123!');
  console.log('  AVM Yönetimi  → admin@terrace-avm.com / MallAdmin123!');
  console.log('  Mağaza Paneli → lcwaikiki@terrace-avm.com / StoreManager123!');

  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
