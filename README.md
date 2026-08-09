# SmartWay AVM

QR tabanlı, ekstra donanım gerektirmeyen Indoor Wayfinding + Reklam/Kampanya SaaS platformu.

**Faz 1** — Ziyaretçi PWA + Rota Motoru (tamamlandı)
**Faz 2** — Auth/RBAC + AVM Yönetim Paneli + Mağaza Paneli + Super Admin Paneli (tamamlandı)
**Faz 3** — AI destekli arama + davranışsal reklam hedefleme + sadakat/çekiliş + çoklu dil (tamamlandı)
**Faz 4** — Dijital Signage/Kiosk + PDR + API/Webhook ekosistemi + okuma replikası altyapısı (tamamlandı)

PRD'deki 4 fazlı yol haritasının tamamı tamamlanmıştır. Detaylar için: [`docs/PRD.md`](docs/PRD.md)

## Kurulum

```bash
cd backend
npm install
cp .env.example .env
npm run db:migrate                          # backend/db/schema.sql
psql "$DATABASE_URL" -f db/schema_v2.sql     # Faz 2: auth, audit log, kategori kampanyası
psql "$DATABASE_URL" -f db/schema_v3.sql     # Faz 3: sadakat, çekiliş, favoriler, push
psql "$DATABASE_URL" -f db/schema_v4.sql     # Faz 4: signage, API anahtarı, webhook, beacon
npm run db:seed
npm start                                     # http://localhost:4000
```

### Ziyaretçi PWA
`http://localhost:4000/?mall=terrace` — Demo QR kodu: **K0-A-05**

### Kiosk / Signage Ekranı
`http://localhost:4000/kiosk.html` — AVM Yönetim Paneli → Signage'da üretilen eşleştirme koduyla bağlanır.

### Yönetim Panelleri
| Panel | URL | Demo Giriş |
|---|---|---|
| AVM Yönetimi | `/admin/mall-admin.html` | `admin@terrace-avm.com` / `MallAdmin123!` |
| Mağaza Paneli | `/admin/store-panel.html` | `lcwaikiki@terrace-avm.com` / `StoreManager123!` |
| Super Admin | `/admin/super-admin.html` | `super@smartwayavm.com` / `SuperAdmin123!` |

## Faz 4 — Yeni Özellikler

**Dijital Signage / Kiosk** — AVM Yönetim Paneli'nden ekran + playlist yönetimi (reklam/kampanya/popup/özel medya içerik sıralaması, gün/saat bazlı zamanlama). Kiosk cihazı `/kiosk.html`'i açıp 6 haneli eşleştirme koduyla bağlanır, JWT gerektirmez. Test edildi: cihaz oluşturma → playlist atama → kiosk'un içeriği doğru çözümlemesi uçtan uca doğrulandı.

**PDR (Pedestrian Dead Reckoning)** — `frontend/public/js/pdr.js`. QR ile alınan kesin başlangıç noktasından sonra, telefonun ivmeölçer + pusula sensörleriyle adım sayıp yön tahmin ederek haritadaki "mavi nokta"yı donanımsız güncel tutar. Görsel bir ipucu katmanıdır (sürüklenme birikir), her QR okutmada sıfırlanır. Üst çubuktaki 📍 düğmesiyle açılır.

**Üçüncü parti API/Webhook ekosistemi** — `X-API-Key` ile korunan `/api/public/v1/*` uçları (mağazalar, kampanyalar, analitik özeti, dış sistemden kampanya oluşturma). Olay-tabanlı webhook'lar (`campaign.created`, `store.created`, `route.completed` vb.) HMAC imzalı payload ile gönderilir, her deneme `webhook_deliveries` tablosunda loglanır (başarısız teslimatlar dahil — bu ortamda dış URL'lere erişim ağ politikası gereği kısıtlı olduğundan gerçek bir "başarısız teslimat + doğru loglama" senaryosu da test edilmiştir).

**Okuma replikası hazırlığı** — `db/pool.js`'te `PG_READ_REPLICA_HOST` tanımlıysa ağır analitik sorguları ayrı bir havuza yönlenir; tanımsızsa birincil havuza düşer (geriye dönük uyumlu, opsiyonel).

**BLE Beacon (opsiyonel donanım, veri modeli hazır)** — `beacons` tablosu, fiziksel donanım kurulduğunda route engine/harita katmanı değişmeden entegre olabilecek şekilde tasarlandı; bu ortamda fiziksel donanım test edilemediğinden yalnızca şema seviyesinde hazırdır.

## Mimari Notu — RBAC & Tenant İzolasyonu

Her panel API'si kendi **benzersiz path önekine** sahiptir (`/api/admin`, `/api/store`, `/api/superadmin`, `/api/public`) ve ilgili middleware zinciriyle korunur. Ziyaretçi ve kiosk API'leri geniş `/api` önekinde olduğundan, daha özgün önekli mount'lar **her zaman önce** tanımlanmalıdır (bkz. `backend/server.js`).

## Proje Durumu

PRD'nin 4 fazı da tamamlandı ve her biri gerçek bir PostgreSQL örneğine karşı uçtan uca test edildi. İleri geliştirme için doğal adaylar: gerçek bir LLM sağlayıcısına geçiş (`services/aiSearch.js`), BullMQ ile webhook retry/backoff, gerçek BLE donanım entegrasyonu, ve Faz 2 PRD'de bahsedilen mikroservis ayrıştırması (ölçek gerektiğinde).

## Sertleştirme & Test (Kod Gözden Geçirme Turu)

Kod tabanı, otomatik bir entegrasyon test paketine (`backend/test/api.test.js`, Node'un yerleşik `node:test` çalıştırıcısı, ekstra bağımlılık yok) karşı gözden geçirildi ve **33/33 test geçiyor**. Bu tur sırasında bulunup düzeltilen gerçek hatalar:

| # | Hata | Etki | Düzeltme |
|---|---|---|---|
| 1 | `/api/favorites/toggle` başka bir AVM'nin `storeId`'siyle çağrılabiliyordu | Çapraz-tenant veri kirliliği | Mağazanın `mall_id`'sini doğrulayan kontrol eklendi (404) |
| 2 | `/api/ads/:id/click` herhangi bir UUID ile çağrılıp sahte tıklama üretilebiliyordu | Diğer AVM'lerin CTR analitiğini kirletme riski | Reklamın bu AVM'ye ait olduğu doğrulanıyor |
| 3 | Yinelenen mağaza/AVM slug'ında 500 dönüyordu | Belirsiz hata, istemci tarafında ayrım yapılamıyordu | PostgreSQL `23505` → temiz `409 Conflict`'e çevrildi |
| 4 | Süper admin AVM onboarding'inde e-posta çakışırsa **sahipsiz AVM** kalıyordu | Veri tutarsızlığı | Mall+kullanıcı oluşturma tek transaction'a alındı |
| 5 | `EARN_RULES` düz obje olduğundan `reason:"__proto__"` prototip kirliliğine yol açabiliyordu | Potansiyel 500/güvenlik riski | `Map` ile değiştirildi |
| 6 | `/api/route`, `/api/loyalty/:visitorId` vb. uçlarda geçersiz UUID doğrudan PostgreSQL'e gidip 500 üretiyordu | Hata detayı sızıntısı riski | Merkezi `isUuid()` doğrulaması eklendi (400) |
| 7 | Bozuk JSON gövdesi genel hata yakalayıcıya düşüp belirsiz bir yanıt veriyordu | Kötü DX | `entity.parse.failed` için özel, temiz `400` |
| 8 | Zayıf/kısa şifrelerle kullanıcı oluşturulabiliyordu | Güvenlik | 8 karakter minimum kural eklendi |
| 9 | `/api/auth/login` yalnızca genel 120/dk limitine tabiydi | Brute-force riski | 15 dakikada 20 deneme özel limiti eklendi |
| 10 | Production'da 5xx hatalarının `err.message`'ı istemciye sızıyordu | Bilgi sızıntısı | 5xx'lerde production'da genel mesaj, detay yalnızca sunucu logunda |
| 11 | Mağaza paneli rotalarında `req.mall` tanımsızdı (yalnızca admin rotalarında `scopeToMall` vardı) | Faz 4 webhook entegrasyonu çökerdi | `scopeToMall` mağaza panel mount'una da eklendi |

### Testleri çalıştırma

```bash
cd backend
npm install
npm run db:migrate && psql "$DATABASE_URL" -f db/schema_v2.sql && psql "$DATABASE_URL" -f db/schema_v3.sql && psql "$DATABASE_URL" -f db/schema_v4.sql
npm run db:seed
npm test
```

Test paketi kapsamı: sağlık kontrolü, ziyaretçi akışı (QR/arama/rota edge-case'leri), auth/RBAC izolasyonu (rol çapraz erişim denemeleri dahil), tenant scoping, sadakat/favori giriş doğrulaması, API anahtarı yaşam döngüsü, yinelenen anahtar davranışı, ve route engine'in saf birim testleri (erişilebilirlik kısıtı, NUMERIC-string regresyon koruması).




## Kat Planı & Harita Editörü

AVM Yönetim Paneli → **Katlar & QR** → bir kat için **"🗺️ Haritayı Düzenle"**:
- Haritada tıklayarak koridor/mağaza girişi/asansör noktaları ekleyin, iki noktayı tıklayarak birbirine bağlayın.
- İsteğe bağlı olarak bir arka plan SVG (gerçek mimari kat planınız) yükleyebilirsiniz — bu görsel içerik doğrudan veritabanında saklanır (Render'ın ücretsiz planındaki kalıcı olmayan disk sorununu bypass eder).
- "Mağaza Ekle" formunda artık bu editörde oluşturduğunuz "Mağaza Girişi" noktalarından birini seçebilirsiniz.
- **Ziyaretçi uygulaması artık bu gerçek veriyi `/api/floors` ucundan dinamik çekiyor** — daha önce yalnızca demo (Terrace AVM) sabit kodluydu, artık girdiğiniz herhangi bir AVM için otomatik çalışır.
