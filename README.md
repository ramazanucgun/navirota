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

PRD'nin 4 fazı da tamamlandı ve her biri gerçek bir PostgreSQL örneğine karşı uçtan uca test edildi. Ardından **Faz 5 — Güvenlik Sertleştirme**, **Faz 6 — Ödeme/Abonelik (iyzico)**, **Faz 7 — CI/CD & İzleme**, **Faz 8 — Ölçeklenebilirlik**, **Faz 9 — KVKK Uyumluluğu** ve **Faz 10 — LLM Arama & Webhook Retry** tamamlandı. Denetim raporunda (`SmartWayAVM_Denetim_Raporu.md`) tespit edilen tüm maddeler kapatıldı; kalan geliştirmeler artık gerçek donanım/altyapı gerektiren opsiyonel işler (BLE beacon donanımı, okuma replikası canlı testi).

## Faz 10 — LLM Arama & Webhook Retry

**56/56 test geçiyor** (53 önceki + 3 yeni). Bu fazda geliştirme sırasında bulunup düzeltilen 2 gerçek hata için ayrıca not düşüldü — sadece kod yazılıp "çalışır" denmedi, gerçek Redis/API'ye karşı test edilerek doğrulandı.

| Bileşen | Açıklama |
|---|---|
| `services/aiSearch.js` — LLM katmanı | Sözlük (`resolveIntentLexicon`) hiçbir kategoriyle eşleşmezse ve `ANTHROPIC_API_KEY` tanımlıysa Claude Haiku'ya tek bir sınıflandırma isteği atılır (2.5sn zaman aşımı, hata/timeout'ta sessizce boş sonuca döner — arama uç noktası LLM'e asla bağımlı hale gelmez). **Gerçek bir ağ çağrısı yapılarak test edildi**: geçersiz bir anahtarla `api.anthropic.com`'a istek atıldı, 401 alındı, 143ms'de sessizce boş sonuca düşüldü (500 değil) — bu, request formatının (header/body) doğru kurulduğunu kanıtlar. `AI_SEARCH_MOCK=true` ile gerçek anahtar olmadan da uçtan uca test edilebilir (CI'da bu mod kullanılıyor). |
| `services/webhookQueue.js` — BullMQ retry | `REDIS_URL` tanımlıysa webhook teslimatları BullMQ kuyruğuna alınır, başarısız denemeler exponential backoff (2s→4s→8s→16s→32s, 5 deneme) ile yeniden denenir. **Gerçek bir retry senaryosuyla test edildi**: yerel bir test sunucusu ilk 2 isteği reddedip 3.'yü kabul etti, `webhook_deliveries` tablosunda 3 ayrı deneme (500, 500, 200) doğru zamanlamayla kayıtlandı. |
| Bulunan hata #1 | `bullmq`, `ioredis` paketini kendiliğinden kurmuyor (opsiyonel peer dependency) — eksikken Worker kurulumu sessizce saniyede 100.000+ satır log üreten bir hata döngüsüne giriyordu. `ioredis` eklendi + `getQueue()`'a savunma amaçlı try/catch eklendi. |
| Bulunan hata #2 | Graceful shutdown yoktu — SIGTERM'de Redis/BullMQ bağlantısı temiz kapanmıyordu. `server.js`'e `SIGTERM`/`SIGINT` handler'ı eklendi, gerçekten `kill -TERM` ile test edildi. |
| Bilinen davranış | Rate-limit sayaçları Redis'te tutulduğundan (Faz 8), aynı dakika içinde test paketini arka arkaya birden fazla kez koşturmak (yerel geliştirmede) sahte başarısızlıklara yol açabilir — aralarda `redis-cli flushall` gerekir. Gerçek bir CI çalıştırması (pipeline başına bir kez) bundan etkilenmez. |

## Faz 9 — KVKK Uyumluluğu

Ziyaretçiler için "verilerimi indir" / "verilerimi sil" self-servis akışı (6698 sayılı KVKK md. 11 — ilgili kişinin erişim/silme hakkı). **53/53 test geçiyor** (48 önceki + 5 yeni), tenant izolasyonu ve FK edge-case'leri dahil gerçek DB'ye karşı test edildi.

| Bileşen | Açıklama |
|---|---|
| `routes/privacy.js` | `GET /api/privacy/:visitorId/export` (tüm sadakat/favori/çekiliş/push-abonelik verisini tek JSON'da döner), `DELETE /api/privacy/:visitorId` (kalıcı silme). Diğer ziyaretçi uçlarıyla (favorites/loyalty) aynı yetkilendirme modeli: visitorId'yi bilmek erişim yetkisidir — ayrıca hesap/şifre yoktur (zaten kişisel kimlik verisi toplanmaz). |
| Tenant izolasyonu | Silme/dışa aktarma yalnızca `visitors.mall_id = req.mall.id` eşleşince çalışır — gerçek ikinci bir AVM oluşturup çapraz-tenant erişim denemesi test edildi (404 dönüyor). |
| FK edge-case | Bir çekilişin kazananı olan ziyaretçi bile hatasız silinebiliyor — `raffles.winner_visitor_id` (CASCADE olmayan tek referans) önce `NULL`'lanıyor, sonra `visitors` satırı siliniyor (geri kalan tablolar zaten `ON DELETE CASCADE`). Gerçek bir çekiliş+kazanan senaryosuyla test edildi. |
| `frontend/public/privacy.html` | Ziyaretçi PWA'sında 🔒 ikonuyla erişilen self-servis sayfa — JSON indirme + onaylı silme akışı. |

## Faz 8 — Ölçeklenebilirlik

Redis destekli rate-limit ve `pg_trgm` arama indekslemesi. **Not:** İlk sürümde `rate-limit-redis`'in bir kütüphane hatası (object-spread ile `init()` prototip metodunu kopyalamaması → `windowMs` hiç set edilmeden her artırmanın sessizce başarısız olması) nedeniyle Redis çalışırken bile sayaç hiç artmıyordu — bu, gerçek sunucuya karşı elle test edilirken (`redis-cli get` ile sayaç değeri kontrol edilerek) yakalandı ve düzeltildi. Ayrıca Redis tamamen erişilemez olduğunda API'nin tamamının kilitlenmesini önleyen bir devre kesici + "fail-open" davranışı eklendi (Redis'siz durumda önce tüm `/api` istekleri 500 dönüyordu — bu da düzeltildi).

| Bileşen | Açıklama |
|---|---|
| `services/rateLimitStore.js` | Rate-limit sayaçları artık `REDIS_URL` tanımlıysa paylaşılan Redis'te tutulabiliyor (yatay ölçekte instance'lar arası tutarlı limit). Gerçek bir Redis'e karşı doğrulandı: `/api/*` isteği sonrası Redis'te `rl:api:<ip>` anahtarının oluştuğu ve TTL/sayaç değerinin doğru olduğu kontrol edildi. `REDIS_URL` tanımlı değilse express-rate-limit'in varsayılan in-memory store'una sorunsuzca düşer (davranış değişmez). |
| `schema_v7.sql` — `pg_trgm` arama indeksi | `stores.name` üzerine `GIN (name gin_trgm_ops)` indeksi eklendi — PRD Faz 1'de vaat edilip daha önce hiç uygulanmamıştı (arama `ILIKE '%...%'` kullanıyor, baştan joker karakterli desenler standart B-Tree ile hızlanmaz). **Ölçülmüş sonuç:** 50.000 satırlık bir tabloda, tipik bir kullanıcı aramasına (belirli bir mağaza adı, ~%0.01 seçicilik) karşı planner otomatik olarak bu indeksi seçiyor ve sorgu **~3.4ms**'de bitiyor; indeks olmadan (seq scan) aynı boyuttaki tabloda karşılaştırılabilir bir sorgu **~24ms** sürüyor. Dürüstlük payı: çok az seçici (örn. tek bir rakam) aramalarda planner bilinçli olarak seq scan'i tercih edebiliyor — bu beklenen ve doğru bir maliyet kararı, indeks yine de mevcut ve gerektiğinde kullanılabilir durumda. |

Production'a çıkmadan önce: `REDIS_URL` set edilmeden birden fazla backend instance'ı çalıştırmak, her instance'ın kendi rate-limit sayacını tutmasına (limitin instance sayısıyla orantılı gevşemesine) yol açar — yatay ölçeğe geçerken bu değişkenin set edilmesi önerilir.

## Faz 7 — CI/CD & İzleme

| Bileşen | Açıklama |
|---|---|
| `.github/workflows/ci.yml` | Her push/PR'da: gerçek bir PostgreSQL servisi ayağa kaldırılır → `npm ci` → migration → seed → `npm test` (48 test) → `npm audit --audit-level=high`. Yerel olarak sıfır bir veritabanına karşı bu dizinin tamamı elle de doğrulandı. |
| `.github/dependabot.yml` | Backend npm bağımlılıkları ve GitHub Actions haftalık taranır, minor/patch güncellemeleri gruplanır. |
| `services/monitoring.js` | Sentry entegrasyonu — `SENTRY_DSN` tanımlı değilse tamamen no-op (yerel geliştirmeyi etkilemez). Yalnızca 5xx (beklenmeyen) hatalar raporlanır; 4xx doğrulama hataları bilinçli olarak gönderilmez (gürültü azaltma). `unhandledRejection`/`uncaughtException` de yakalanıp raporlanır. |
| `GET /healthz` | Artık yalnızca process'in ayakta olduğunu değil, veritabanına gerçekten bağlanabildiğini de kontrol ediyor (`SELECT 1`) — DB erişilemezse `503` döner. Yük dengeleyici/uptime probe'ları için doğru sinyal. |

## Faz 6 — Ödeme / Abonelik (iyzico)

mall_admin panelinden self-servis plan yükseltme akışı eklendi. Tüm akış (checkout başlatma → ödeme → callback → plan güncelleme) gerçek bir PostgreSQL'e karşı uçtan uca test edildi, **48/48 test geçiyor** (41 önceki + 7 yeni).

| Bileşen | Açıklama |
|---|---|
| `services/iyzico.js` | iyzico Checkout Form API (V2/IYZWSv2) entegrasyonu. Resmi `iyzipay` SDK'sı **bilinçli olarak kullanılmadı** — `npm audit`'te orta seviye güvenlik açığı çıkaran eski `postman-request`/`qs`/`uuid` bağımlılık zincirine sahip. Bunun yerine native `fetch`+`crypto` ile HMACSHA256 imzalı yetkilendirme doğrudan uygulandı, sıfır ek bağımlılıkla. |
| `IYZICO_MOCK` modu | API anahtarları tanımlı değilse (varsayılan) gerçek ağ çağrısı yapılmaz, "başarılı ödeme" simüle edilir — bu sayede checkout→callback→plan-güncelleme iş mantığı API anahtarı olmadan da uçtan uca test edilebilir. |
| `routes/admin/billing.js` | mall_admin için `GET /billing` (plan+fatura geçmişi), `GET /billing/plans`, `POST /billing/checkout` (hosted ödeme sayfası başlatma — kart bilgisi hiç sunucumuza dokunmaz). |
| `routes/billing/callback.js` | iyzico'nun callback'i — **bilinçli olarak** kimlik doğrulamasız/CORS-kısıtsız (provider'ın kendi sayfasından top-level yönlendirme), ama token her zaman sunucu-sunucu tekrar doğrulanır (istemciden gelen "başarılı" iddiasına asla güvenilmez), idempotent (aynı token ikinci kez gelirse hata vermez). |
| `services/planLimits.js` | Plan bazlı kullanım limitleri (`max_stores`, `max_floors`, `max_admins`) ve özellik kapıları (`features.ai_search` vb.) — limit dolunca `402 Payment Required` döner. Mağaza/kat oluşturma ve mall_admin davet uçlarına uygulandı; AI arama Starter planında devre dışı. |
| `schema_v6.sql` | `invoices` tablosuna `plan_id`/`provider`/`conversation_id`/`checkout_token`/`provider_payment_id` eklendi, `malls`'a `current_period_end` eklendi. |

Production'a çıkmadan önce: `IYZICO_API_KEY`/`IYZICO_SECRET_KEY` gerçek (önce sandbox, sonra canlı) değerlerle set edilmeli; `routes/admin/billing.js`'teki `identityNumber` alanı gerçek bir AVM faturalama profili akışına bağlanmalı (şu an placeholder).

## Faz 5 — Güvenlik Sertleştirme

Denetim raporunda tespit edilen kritik güvenlik açıkları kapatıldı, tüm değişiklikler gerçek bir PostgreSQL'e karşı doğrulandı.

| # | Konu | Yapılan |
|---|---|---|
| 1 | JWT_SECRET fallback'i | Production'da bu env değişkeni tanımlı değilse uygulama artık **başlamayı reddediyor** (`services/auth.js`) |
| 2 | Refresh token rotasyonu yoktu | Her `/api/auth/refresh`'te eski token iptal edilip yenisi veriliyor; rotasyona uğramış bir token tekrar sunulursa (çalıntı token belirtisi) kullanıcının **tüm** oturumları iptal ediliyor (`schema_v5.sql`, `routes/auth.js`) |
| 3 | Parola sıfırlama akışı yoktu | `POST /api/auth/forgot-password` + `POST /api/auth/reset-password` eklendi (enumeration'a karşı jenerik yanıt, 1 saatlik tek kullanımlık token, sıfırlama sonrası tüm oturumlar kapanıyor); `admin/reset-password.html` sayfası + `services/email.js` (SMTP yoksa dev-mode'da console'a loglar) |
| 4 | CORS tamamen açıktı | Yönetim panelleri (`/api/admin`, `/api/store`, `/api/superadmin`, `/api/auth`) artık `ALLOWED_ORIGINS` env değişkenine göre kısıtlanabiliyor |
| 5 | Helmet varsayılan CSP | Bilinçli bir CSP tanımlandı (`script-src 'self'`, inline script yok) — bunun için `kiosk.html`'deki inline `<script>`/`<style>` harici dosyalara taşındı, admin panellerindeki inline `style=` attribute'ları CSS sınıfına taşındı |

Kapsam dışı bırakılanlar (bilinçli): Row-Level Security (ikinci savunma katmanı, ayrı bir görev), admin panel JS dosyalarındaki `innerHTML` üzerinden enjekte edilen `style=""` attribute'ları (bu yüzden `style-src`'de hâlâ `'unsafe-inline'` var — `script-src`'de yok).

## Sertleştirme & Test (Kod Gözden Geçirme Turu)

Kod tabanı, otomatik bir entegrasyon test paketine (`backend/test/api.test.js`, Node'un yerleşik `node:test` çalıştırıcısı, ekstra bağımlılık yok) karşı gözden geçirildi. Bu tur sırasında bulunup düzeltilen gerçek hatalar:

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
npm run db:migrate && psql "$DATABASE_URL" -f db/schema_v2.sql && psql "$DATABASE_URL" -f db/schema_v3.sql && psql "$DATABASE_URL" -f db/schema_v4.sql && psql "$DATABASE_URL" -f db/schema_v5.sql && psql "$DATABASE_URL" -f db/schema_v6.sql && psql "$DATABASE_URL" -f db/schema_v7.sql
npm run db:seed
npm test
```

Test paketi kapsamı: sağlık kontrolü, ziyaretçi akışı (QR/arama/rota edge-case'leri), auth/RBAC izolasyonu (rol çapraz erişim denemeleri dahil), tenant scoping, refresh token rotasyonu + reuse tespiti, parola sıfırlama akışı, ödeme/abonelik akışı (checkout→callback→plan güncelleme, mock modda), plan bazlı kullanım limitleri, KVKK veri dışa aktarma/silme (tenant izolasyonu + FK edge-case dahil), LLM destekli AI arama (mock modda), gerçek bir HTTP alıcısına webhook teslimatı, sadakat/favori giriş doğrulaması, API anahtarı yaşam döngüsü, yinelenen anahtar davranışı, ve route engine'in saf birim testleri (erişilebilirlik kısıtı, NUMERIC-string regresyon koruması).




## Kat Planı & Harita Editörü

AVM Yönetim Paneli → **Katlar & QR** → bir kat için **"🗺️ Haritayı Düzenle"**:
- Haritada tıklayarak koridor/mağaza girişi/asansör noktaları ekleyin, iki noktayı tıklayarak birbirine bağlayın.
- İsteğe bağlı olarak bir arka plan SVG (gerçek mimari kat planınız) yükleyebilirsiniz — bu görsel içerik doğrudan veritabanında saklanır (Render'ın ücretsiz planındaki kalıcı olmayan disk sorununu bypass eder).
- "Mağaza Ekle" formunda artık bu editörde oluşturduğunuz "Mağaza Girişi" noktalarından birini seçebilirsiniz.
- **Ziyaretçi uygulaması artık bu gerçek veriyi `/api/floors` ucundan dinamik çekiyor** — daha önce yalnızca demo (Terrace AVM) sabit kodluydu, artık girdiğiniz herhangi bir AVM için otomatik çalışır.

## Temiz AVM URL'leri

Artık her AVM'nin kendi kısa, paylaşılabilir/QR-dostu URL'i var:

```
navirota.com/iyasparkavm         ← Ziyaretçi PWA (eski: navirota.com/?mall=iyasparkavm)
navirota.com/terrace             ← Demo AVM
```

Eski `?mall=slug` biçimi de çalışmaya devam eder (geriye dönük uyumlu) — öncelik sırası: temiz URL → `?mall=` → varsayılan (`terrace`).

- Admin panelleri (`/admin/*.html`), kiosk (`/kiosk.html`) ve statik varlıklar (`/js`, `/css`, `/icons`) bu yönlendirmeden etkilenmez — sunucu önce gerçek dosyaları arar, yalnızca eşleşme yoksa path'i bir AVM slug'ı olarak yorumlar.
- PWA manifest'i artık dinamiktir (`GET /manifest.json?mall=slug`) — "Ana ekrana ekle" ile yüklenen kısayol, doğrudan ilgili AVM'nin temiz URL'ine açılır.
