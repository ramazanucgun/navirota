# SmartWay AVM — Ürün Gereksinim Dokümanı (PRD) v1.0

**Durum:** Onay bekliyor — geliştirme bu doküman onaylanmadan başlamayacak.
**Kapsam:** QR-tabanlı Indoor Wayfinding + Reklam/Kampanya SaaS Platformu
**Hedef Pazar:** Türkiye AVM'leri (Faz 1) → Uluslararası (Faz sonrası)

---

## İçindekiler

1. Ürün Analizi (PRD Özeti)
2. Rakip Analizi
3. Modül Planlaması
4. Sistem Mimarisi
5. Veritabanı Tasarımı
6. Harita Motoru (Route Engine)
7. QR Sistemi
8. Reklam Platformu
9. Kampanya Platformu
10. Yapay Zeka Özellikleri
11. Dijital Signage Entegrasyonu
12. Mobil / PWA / Offline
13. Güvenlik
14. Performans ve Ölçeklenebilirlik
15. Yol Haritası (Fazlar)

---

## 1. Ürün Analizi (PRD Özeti)

### 1.1 Problem Tanımı

Türkiye'deki AVM'lerin büyük çoğunluğu ziyaretçi yönlendirme sorununu ya hiç çözmüyor (statik tabela + kağıt kat planı) ya da BLE beacon / Wi-Fi RTLS gibi kurulumu ve bakımı pahalı sistemlerle çözmeye çalışıyor. Bu sistemler:

- Yüksek başlangıç yatırımı gerektirir (donanım + kurulum işçiliği + kalibrasyon).
- Pil değişimi, sinyal kayması, donanım arızası gibi sürekli bakım maliyeti yaratır.
- AVM yönetimine doğrudan gelir getirmez; yalnızca gider kalemidir.
- Küçük ve orta ölçekli AVM'ler için yatırım geri dönüşü (ROI) belirsizdir.

**SmartWay AVM'nin farkı:** Donanım yatırımı sıfıra yakın (yalnızca QR etiket basımı), konumlandırma "kullanıcı beyanı + graf tabanlı rota" ile çözülür, ve sistem AVM'ye **reklam ve kampanya geliri** ile kendini amorti eder. Bu, ürünü bir "maliyet merkezi" değil bir "gelir merkezi" olarak konumlandırır — satış sürecinde en güçlü argümanımız budur.

### 1.2 Hedef Kullanıcılar (Persona)

| Persona | İhtiyaç | Başarı Kriteri |
|---|---|---|
| **Ziyaretçi** | Hızlıca mağazasını/hizmetini bulmak | 3 dokunuştan az, <10 sn'de rota |
| **Mağaza Yöneticisi** | Kampanya yayınlamak, görünürlük kazanmak | Kendi kendine yönetebilme (self-servis) |
| **AVM Operasyon Müdürü** | Doluluk/yoğunluk verisi, reklam geliri | Aylık gelir raporu, ısı haritası |
| **AVM Pazarlama Müdürü** | Etkinlik/duyuru yayınlamak, marka sponsorlukları satmak | Kampanya oluşturma <5 dk |
| **SmartWay Super Admin (biz)** | Çoklu AVM'yi tek panelden yönetmek, lisans/fatura takibi | Yeni AVM onboarding <1 gün |
| **Erişilebilirlik ihtiyacı olan ziyaretçi** | Merdivensiz/asansörlü rota | Rota tercihi ile garanti edilen erişilebilir yol |

### 1.3 Temel Kullanım Senaryosu (Happy Path)

1. Ziyaretçi AVM girişindeki QR'ı okutur → tarayıcıda PWA açılır, konum otomatik belirlenir.
2. Arama kutusuna mağaza adı ya da doğal dil isteği yazar ("kahve içmek istiyorum").
3. Sonuç listesinde varsa aktif kampanya rozeti görünür.
4. Mağazayı seçer → animasyonlu rota, kat değişimleri dahil, adım adım gösterilir.
5. Rota tamamlanınca "Rota Tamamlandı" ekranında ilgili kategoriye hedeflenmiş bir reklam gösterilir.
6. Ziyaretçi favori mağazasını kaydeder; o mağaza kampanya yayınladığında push bildirimi alır.

### 1.4 Verilen Gereksinimlere Ek Profesyonel Öneriler

Kullanıcının orijinal spesifikasyonuna ek olarak, dünya standardındaki wayfinding ürünlerini referans alarak önerilen ek kapsamlar:

- **No-code Harita CMS:** Mappedin ve Pointr gibi lider oyuncuların 2026 konumlandırmasının merkezinde "GIS uzmanı gerektirmeden, dakikalar içinde harita güncelleme" var. Bizim AVM Yönetim Paneli'nde kat planı SVG düzenleyicisi bu prensiple tasarlanmalı — mağaza taşındığında AVM operasyon ekibi kod/geliştirici olmadan güncelleyebilmeli.
- **"Blue Dot" hibrit konumlandırma yol haritası:** Faz 1'de yalnızca QR ile başlangıç noktası belirlenecek, ancak Faz 3+ için telefonun jiroskop/adım sayar (PDR – Pedestrian Dead Reckoning) verisiyle QR sonrası yaklaşık konum tahmini eklenmesi, rakiplerin sunduğu "sürekli konum" hissine QR'ın tekrar okutulmasına gerek kalmadan yaklaşmamızı sağlar. Bu, donanım gerektirmez, yalnızca yazılımsal bir iyileştirmedir.
- **Erişilebilirlik önceliği (GoodMaps prensibi):** Rakip analizinde öne çıkan GoodMaps, engelli bireyler için "adım-serbest rota", "daha az kalabalık rota" gibi kişiselleştirilmiş rota tercihleri sunuyor. Bizim `preference` parametresi (`shortest`/`accessible`/`least_stairs`) bunun temelini atıyor; öneri: buna "sessiz saatler rotası" (kalabalıktan kaçınma, analitik verisiyle beslenir) Faz 3'te eklenmeli.
- **Sponsorluk envanteri olarak haritanın kendisi:** Rakiplerin çoğu (Pointr, MapsPeople) haritayı yalnızca bir yardımcı araç olarak konumlandırıyor; bizim önerimiz haritayı doğrudan bir reklam envanteri olarak modellemek (kategori sponsorluğu, rota sponsorluğu) — bu, dokümanın 8. bölümünde detaylandırıldı ve Türkiye pazarında rakiplerin sunmadığı bir farklılaştırıcı.
- **Offline-first QR okuma:** Kullanıcının belirttiği gibi QR internetsiz okunabilmeli; öneri: service worker ile son senkronize edilen graf + mağaza verisi cihazda tutulmalı, QR kodu yalnızca bir node ID/URL taşıdığından offline'da da başlangıç noktası anında çözülebilir, rota hesaplaması da tamamen istemci tarafında (aynı route engine JS modülü) çalışabilmeli.
- **Multi-tenant beyaz-etiket (white-label):** Her AVM kendi marka renklerini, logosunu, fontunu tema olarak tanımlayabilmeli (`malls.theme` alanı zaten şemada var) — bu, SaaS satışında "bizim markamız görünüyor, üçüncü parti gibi hissettirmiyor" itirazını ortadan kaldırır.
- **Veri taşınabilirliği ve API-first tasarım:** Büyük AVM zincirlerinin kendi CRM/ERP sistemleriyle entegrasyon talep etmesi kaçınılmaz; tüm modüller (bkz. Bölüm 3) REST API üzerinden dışa açık olmalı, ileride GraphQL katmanı eklenebilir.

---

## 2. Rakip Analizi

### 2.1 İncelenen Oyuncular ve Konumlandırmaları

| Firma | Konumlandırma Teknolojisi | Öne Çıkan Özellik | Donanım Gereksinimi |
|---|---|---|---|
| **Mappedin** | Wi-Fi/GPS/VPS füzyonu, beacon-free "Unified Blue Dot" | AI destekli hızlı harita üretimi, no-code CMS, Power BI entegrasyonu | Hayır (2026 itibarıyla beacon-free) |
| **Pointr** | Patentli "Deep Location" + AI tabanlı "MapScale" 3D harita üretimi | Cisco Spaces entegrasyonu, kurumsal ölçek, geofence yönetimi | Kısmen (yüksek doğrulukta opsiyonel donanım) |
| **Mapwize** | Geliştirici odaklı esnek API | Kolay entegre edilebilir SDK | Değişken |
| **IndoorAtlas** | Manyetik alan parmak izi (magnetic positioning) | Ekstra donanım gerektirmeyen konumlandırma | Hayır |
| **Oriient** | Manyetik + sensör füzyonu, "GPS-benzeri" iç mekan konumlandırma | Beacon-free, telefonun kendi sensörleriyle çalışma | Hayır |
| **MazeMap** | Kampüs/hastane odaklı, Wi-Fi destekli | Eğitim ve sağlık sektörüne özel iş akışları | Değişken |
| **GoodMaps** | Erişilebilirlik-öncelikli konumlandırma | Görme engelliler için sesli yönlendirme, 2-3 feet doğruluk, kişiselleştirilmiş rota (adımsız/az kalabalık) | Kısmen |
| **Situm** | Wi-Fi + Bluetooth çoklu teknoloji füzyonu | Barrier-free rota SDK'ları, iç-dış mekan birleşik navigasyon | Kısmen (BLE opsiyonel) |
| **MapsPeople (MapsIndoors)** | Bina yönetim sistemleriyle entegre | Çoklu platform desteği, BMS entegrasyonu | Değişken |

### 2.2 QR ile Yapılabilecekler / Donanım Gerektirenler / İleride Eklenebilecekler

**QR + yazılım ile tamamen yapılabilir (Faz 1-2 kapsamımız):**
- Başlangıç noktası belirleme
- Statik graf tabanlı rota hesaplama (A*/Dijkstra)
- Mağaza/kampanya/reklam yönetimi ve gösterimi
- Offline harita/graf önbellekleme (PWA)
- Kategori/arama bazlı akıllı reklam hedefleme
- Analitik (arama logları, rota logları, QR okutma sıklığı)

**Ekstra donanım/sensör gerektiren (rakiplerin sunduğu ama bizim kapsamımızda olmayan):**
- Sürekli "blue dot" canlı konum takibi (BLE beacon, Wi-Fi RTLS, UWB)
- Manyetik alan parmak izi ile kalibrasyonsuz konumlandırma (IndoorAtlas/Oriient tarzı) — özel SDK/kalibrasyon süreci gerektirir
- Kiosk/dijital ekranlarda kamera tabanlı insan sayımı

**İleride (donanımsız veya düşük maliyetli donanımla) eklenebilir — Faz 3+:**
- Telefon sensörleriyle PDR (adım sayar + jiroskop) tabanlı QR-sonrası yaklaşık konum güncelleme — donanım gerektirmez
- Kamera tabanlı AR yön oku (telefon kamerasından SVG rota overlay) — donanım gerektirmez, yalnızca yazılım
- Opsiyonel düşük maliyetli BLE beacon paketi (yalnızca "premium" plan isteyen AVM'ler için, sürekli blue-dot deneyimi)
- Dijital signage ekranlarına entegre kamera ile anonim yoğunluk tahmini (isteğe bağlı donanım modülü)

### 2.3 Sonuç

Pazardaki oyuncuların neredeyse tamamı 2026 itibarıyla "beacon-free" konumlandırmaya yöneliyor; bu bizim QR-öncelikli stratejimizi doğruluyor. Ancak hiçbiri **reklam/kampanya platformunu birincil gelir modeli** olarak konumlandırmıyor — çoğu SaaS lisans ücretiyle geçiniyor. SmartWay AVM'nin rekabet avantajı, düşük kurulum maliyeti + reklam geliri paylaşımı modelinin birleşimidir; bu, özellikle fiyata duyarlı Türkiye orta ölçekli AVM pazarında güçlü bir konumlandırma sağlar.

---

## 3. Modül Planlaması

Sistem, her biri bağımsız geliştirilip dağıtılabilecek (ileride mikroservise bölünebilecek şekilde modüler monolit olarak başlayan) modüllere ayrılır:

| # | Modül | Sorumluluk |
|---|---|---|
| 1 | **Core** | Ortak yardımcılar, config, hata yönetimi, logging altyapısı |
| 2 | **Tenant** | AVM (mall) kayıt/izolasyon, plan/lisans ilişkisi |
| 3 | **Authentication** | JWT tabanlı kimlik doğrulama, refresh token, oturum yönetimi |
| 4 | **Permission (RBAC)** | Rol bazlı yetkilendirme (super_admin/mall_admin/store_manager) |
| 5 | **Map Engine** | SVG kat planı yükleme/düzenleme, polygon/node/edge veri modeli |
| 6 | **Route Engine** | A*/Dijkstra graf çözümleyici, kat geçişi, erişilebilirlik tercihleri |
| 7 | **QR Engine** | QR üretim, yazdırma şablonu, çözümleme, tip yönetimi (Bölüm 7) |
| 8 | **Navigation** | Arama, rota API'si, adım-adım talimat üretimi |
| 9 | **Mall CMS** | Kat/AVM bilgisi, duyuru/popup yönetimi |
| 10 | **Store CMS** | Mağaza profili, ürün, çalışma saatleri |
| 11 | **Campaign** | Kampanya/kupon/sadakat/çekiliş (Bölüm 9) |
| 12 | **Advertising** | Reklam envanteri, hedefleme, gösterim/tıklama takibi (Bölüm 8) |
| 13 | **AI** | Doğal dil arama, öneri motoru, tahminleme (Bölüm 10) |
| 14 | **Analytics / Reporting** | Log toplama, agregasyon, dashboard verisi, ısı haritası |
| 15 | **Notification** | Push (PWA), e-posta, uygulama-içi bildirim |
| 16 | **Media** | Görsel/video yükleme, CDN dağıtımı, boyutlandırma |
| 17 | **Localization (i18n)** | Çoklu dil içerik yönetimi (TR/EN/AR/RU/DE) |
| 18 | **Theme** | AVM'ye özel marka renkleri/fontları (white-label) |
| 19 | **Payment / Subscription** | Plan/fatura, ödeme sağlayıcı entegrasyonu |
| 20 | **Digital Signage** | Ekran/kiosk yönetimi, içerik zamanlaması (Bölüm 11) |
| 21 | **PWA / Offline** | Service worker, önbellekleme stratejisi (Bölüm 12) |
| 22 | **Admin (Mall/Store Panel)** | AVM ve mağaza yönetim arayüzleri |
| 23 | **Super Admin** | Çoklu AVM, lisans, fatura, destek (SaaS operasyon paneli) |
| 24 | **API Gateway** | Dış geliştiriciler / entegratörler için versiyonlanmış REST API |
| 25 | **Audit Log** | Kritik işlemlerin değiştirilemez kaydı (kim, ne, ne zaman) |

Her modül kendi route/service/repository katmanına sahiptir; modüller arası iletişim doğrudan veritabanı erişimi yerine servis fonksiyonları üzerinden yapılır — bu, ileride modülün ayrı bir mikroservise taşınmasını (örn. Route Engine yüksek trafik altında ayrılabilir) kolaylaştırır.

---

## 4. Sistem Mimarisi

### 4.1 Üst Seviye Mimari

```
                         ┌─────────────────────┐
                         │   CDN (statik/medya)  │
                         └──────────┬───────────┘
                                    │
        ┌───────────────┐   ┌──────▼───────┐   ┌──────────────────┐
        │ Ziyaretçi PWA │   │  Load Balancer│   │ Signage / Kiosk   │
        └──────┬────────┘   └──────┬───────┘   └─────────┬─────────┘
               │                    │                      │
               └─────────────┬──────┴──────────┬───────────┘
                              ▼                 ▼
                     ┌─────────────────────────────┐
                     │      API Gateway (Express)    │
                     │  - Rate limit  - Auth  - CORS  │
                     └───────────────┬───────────────┘
                                      │
        ┌───────────────┬────────────┼────────────┬───────────────┐
        ▼                ▼            ▼            ▼               ▼
  ┌───────────┐   ┌────────────┐ ┌─────────┐ ┌───────────┐  ┌────────────┐
  │ Navigation│   │ Advertising│ │ Campaign│ │ Analytics │  │  Admin API │
  │  Service  │   │  Service   │ │ Service │ │  Service  │  │  Services  │
  └─────┬─────┘   └─────┬──────┘ └────┬────┘ └─────┬─────┘  └─────┬──────┘
        │               │              │            │              │
        └───────┬───────┴──────┬───────┴─────┬──────┴──────┬───────┘
                ▼               ▼             ▼             ▼
          ┌──────────┐   ┌───────────┐  ┌──────────┐  ┌────────────┐
          │PostgreSQL│   │   Redis    │  │  Queue    │  │Object Store│
          │ (primary)│   │(cache/sess)│  │(BullMQ)   │  │ (S3 uyumlu)│
          └──────────┘   └───────────┘  └──────────┘  └────────────┘
                                                │
                                        ┌───────▼────────┐
                                        │ Socket.IO (WS)  │
                                        │ canlı popup/    │
                                        │ signage push    │
                                        └─────────────────┘
```

### 4.2 Bileşen Kararları ve Gerekçeleri

| Katman | Teknoloji | Gerekçe |
|---|---|---|
| API | Node.js + Express | Hafif, geniş ekosistem, JS route engine ile paylaşılan kod (istemci/sunucu) |
| Veritabanı | PostgreSQL | JSONB desteği (tema, özellik bayrakları), güçlü ilişkisel bütünlük, coğrafi/graf sorguları için yeterli |
| Cache/Oturum | Redis | Rate-limit sayaçları, oturum, sık sorgulanan rota/arama sonuçlarının kısa süreli önbelleği |
| Kuyruk | BullMQ (Redis tabanlı) | Push bildirim, rapor üretimi, medya işleme gibi asenkron işler |
| Gerçek zamanlı | Socket.IO | AVM popup'ının anlık yayını, signage ekranlarına canlı içerik itme |
| Arama | PostgreSQL `pg_trgm` / `tsvector` (Faz 1) → Elasticsearch/Meilisearch (Faz 3, ölçek gerektiğinde) | Başlangıçta ek altyapı maliyeti yok; ölçek büyüdükçe ayrıştırılabilir |
| Medya/CDN | S3-uyumlu object storage + CDN (CloudFront/Bunny/Cloudflare) | Logo, banner, video gibi statik varlıkların düşük gecikmeyle dağıtımı |
| Kimlik doğrulama | JWT (access + refresh token), RBAC middleware | Stateless API, mobil/PWA için uygun |
| Loglama | Yapılandırılmış JSON log (pino/winston) → merkezi log toplayıcı (Loki/ELK) | Hata ayıklama ve audit için aranabilir log |
| İzleme (Monitoring) | Prometheus + Grafana (metrik), Sentry (hata takibi) | Uptime, gecikme, hata oranı görünürlüğü |
| Yedekleme | PostgreSQL PITR (point-in-time recovery) + günlük snapshot, object storage versiyonlama | Veri kaybı riskine karşı |
| Rate Limit | `express-rate-limit` (Redis store, dağıtık ortamda tutarlılık için) | Kötüye kullanım ve DDoS'a karşı temel koruma |
| Audit Log | Ayrı `audit_log` tablosu + değişmez (append-only) kayıt | Kim/ne/ne zaman değiştirdi sorularına yanıt, uyumluluk |

### 4.3 Neden Modüler Monolit (mikroservis değil, henüz)?

100 AVM / 10.000 mağaza ölçeğinde modüler monolit; operasyonel karmaşıklığı (deployment, izleme, dağıtık transaction yönetimi) düşük tutarken modül sınırlarını korur. Route Engine veya Advertising gibi trafiği orantısız büyüyen modüller, iç API sözleşmeleri zaten net tanımlandığı için ileride bağımsız servislere ayrıştırılabilir (bkz. Bölüm 15, Faz 4).

---

## 5. Veritabanı Tasarımı

Ayrıntılı SQL şeması `backend/db/schema.sql` dosyasında uygulanmıştır (bu doküman onaylandıktan sonra genişletilecek çekirdek tablolar zaten mevcuttur: `malls`, `plans`, `floors`, `nav_nodes`, `nav_edges`, `qr_codes`, `stores`, `campaigns`, `ads`, `visitor_sessions`, `route_logs`, `search_logs` vb.)

### 5.1 Tasarım İlkeleri

- **Tenant izolasyonu:** Tenant'a özgü her tablo `mall_id` (veya `store_id` üzerinden dolaylı) foreign key taşır; tüm sorgular uygulama katmanında bu alanla filtrelenir. İleride PostgreSQL Row-Level Security (RLS) politikaları ile veritabanı seviyesinde ikinci bir savunma katmanı eklenmesi planlanır (Faz 2).
- **Birincil anahtarlar:** Tüm tablolarda `UUID` (gen_random_uuid()) — çoklu-tenant ortamda ID çakışmasını ve sıralı-ID'den tenant büyüklüğü sızıntısını önler.
- **Soft delete:** Kullanıcıya görünen varlıklarda (`stores`, `campaigns`, `ads`, `mall_popups`) fiziksel silme yerine `is_active` / `deleted_at` alanı kullanılacak şekilde genişletilecek — yanlışlıkla silmeye karşı geri alınabilirlik ve geçmiş rapor tutarlılığı sağlar.
- **Versiyonlama:** Kat planı (`floors.svg_url`) ve graf değişiklikleri için `floor_versions` tablosu Faz 2'de eklenecek; her yayına alınan harita sürümü saklanacak, gerektiğinde önceki sürüme dönülebilecek.
- **Audit:** `audit_log(id, actor_user_id, mall_id, entity, entity_id, action, diff_jsonb, created_at)` — kritik CMS/finansal işlemler için değişmez kayıt.
- **İndeksleme:** Sık filtrelenen alanlarda (`mall_id`, `floor_id`, aktiflik + tarih aralığı) kısmi/bileşik indeksler tanımlıdır (bkz. schema.sql sonundaki `CREATE INDEX` blokları).
- **Benzersizlik:** `(mall_id, slug)`, `(floor_id, code)`, `qr_codes.code` gibi doğal anahtarlarda `UNIQUE` kısıtları uygulanmıştır.
- **Referans bütünlüğü:** Tüm ilişkiler `FOREIGN KEY ... ON DELETE CASCADE/SET NULL` ile tanımlıdır; bir AVM silindiğinde bağımlı veriler tutarlı şekilde temizlenir.

### 5.2 Genişletilecek Alanlar (Faz 2+)

- `floor_versions`, `store_versions` — versiyon geçmişi
- `loyalty_points`, `loyalty_transactions` — sadakat puanı (Bölüm 9)
- `raffles`, `raffle_entries` — dijital çekiliş
- `signage_devices`, `signage_playlists` — dijital ekran yönetimi (Bölüm 11)
- `api_keys`, `webhooks` — üçüncü parti entegrasyon (API-first genişleme)

---

## 6. Harita Motoru (Route Engine)

### 6.1 Veri Modeli

- **Node (`nav_nodes`):** Koridor kesişimi, mağaza girişi, asansör/merdiven/yürüyen merdiven ucu, QR noktası, POI (WC/ATM/mescit/otopark). Her node bir kata (`floor_id`) ve SVG koordinatına (`x`, `y`) bağlıdır.
- **Edge (`nav_edges`):** İki node arasındaki yürünebilir bağlantı; `weight` (mesafe/maliyet), `edge_type` (walk/elevator/escalator/stairs).
- **Polygon:** Mağaza alanları `stores.polygon` alanında SVG polygon noktaları olarak tutulur — yalnızca görsel/vurgulama amaçlı, rota hesaplamasına dahil değildir (rota, `entrance_node_id` üzerinden hesaplanır).
- **Kat geçişi:** Farklı katlardaki asansör/merdiven node'ları `linked_group` alanıyla eşleştirilir; aralarındaki `edge_type='elevator'` kenarı tek graf içinde kat sınırını aşan rotayı mümkün kılar.

### 6.2 Algoritma

`backend/services/routeEngine.js` içinde uygulanan `NavGraph` sınıfı:

- **A\*** kullanır; aynı kat içinde öklid mesafesi sezgisel (heuristic) olarak kullanılır, farklı kat karşılaştırmalarında sezgisel 0'a düşürülerek algoritma güvenli şekilde Dijkstra'ya indirgenir (yine de optimal sonuç garantilenir).
- **Tercih bazlı maliyet fonksiyonu:** `shortest` (ham mesafe), `accessible` (merdiven kenarları tamamen elenir, yalnızca erişilebilir node/asansör), `least_stairs` (merdivene ağır ceza, ama tamamen yasaklamaz — alternatif yoksa kullanılabilir).
- **Talimat üretimi:** Ardışık üç node'un vektör açısına bakarak "sağa dönün / sola dönün / düz devam" talimatları ve kat değişim adımları otomatik üretilir.
- **İstemci tarafı taşınabilirlik:** Aynı `NavGraph` modülü, offline PWA senaryosunda tarayıcıda da çalışacak şekilde bağımlılıksız (framework-agnostic) yazılmıştır — bu, offline-first gereksinimini karşılar.

### 6.3 3D'ye Hazır Tasarım (İleri Faz)

Bugünkü model 2D SVG (x, y + floor_id) kullanır. 3D desteğine geçiş için önerilen yol:

- `nav_nodes` tablosuna opsiyonel `z` (yükseklik, metre) alanı eklenir — mevcut 2D sorgular etkilenmez (nullable).
- Route engine'deki `_euclid` fonksiyonu 3 boyutlu mesafeye genelleştirilebilir hale getirilir (zaten fonksiyon izole, tek noktadan değiştirilebilir).
- Görselleştirme katmanı SVG'den Three.js/WebGL tabanlı bir 3B görüntüleyiciye modüler olarak geçebilir; **route engine ve veri modeli bu geçişten bağımsız kalacak şekilde tasarlanmıştır** — bu, "ileride 3D eklenebilsin" gereksinimini mimari seviyede karşılar.

---

## 7. QR Sistemi

### 7.1 Kapsamlı QR Tipleri

`qr_codes.code` alanı yalnızca "başlangıç noktası" değil, aşağıdaki tüm node tiplerine atanabilir (`nav_nodes.node_type` ile hizalı):

| Tip | Örnek Kod | Kullanım |
|---|---|---|
| Kat girişi | `K0-A-05` | Genel başlangıç noktası |
| Koridor | `K1-C-12` | Ara yönlendirme noktası |
| Mağaza kapısı | `K0-STORE-ZARA` | "Buradayım" / mağaza içi kampanya QR'ı |
| Asansör | `K0-ELV-1` | Erişilebilir rota başlangıcı |
| Yürüyen merdiven | `K0-ESC-2` | — |
| Otopark | `B2-A-034` | "Aracımı nereye park ettim" özelliği ile entegre |
| Etkinlik alanı | `K1-EVENT-STAGE` | Etkinlik takvimiyle ilişkili |
| Stant | `K0-STAND-07` | Geçici/pop-up satış noktaları |
| Restoran / yemek alanı | `K2-FOOD-03` | Kategori bazlı QR |
| WC / ATM / Mescit | `K0-WC-2` | Hızlı erişim POI'leri |

### 7.2 QR Yönetim Sistemi (AVM Paneli)

- **Toplu üretim:** Bir kat planı yüklendiğinde, tanımlanan tüm node'lar için QR toplu olarak (ZIP/PDF etiket şablonu) üretilebilir.
- **Yazdırılabilir şablon:** Logo + AVM teması + QR + kod etiketi içeren, standart etiket yazıcı boyutlarına (örn. 5x5 cm) uygun PDF üretimi (pdf modülü ile).
- **Yaşam döngüsü takibi:** `printed_at` alanı ile hangi QR'ların fiziksel olarak basılıp asıldığı takip edilir; saha ekibi checklist'i buradan türetilir.
- **Yeniden atama:** Bir node fiziksel olarak taşınırsa (örn. koridor düzenlemesi), QR kodu aynı kalıp yalnızca hedef node güncellenebilir — fiziksel etiketi değiştirmeye gerek kalmaz.
- **Offline okuma:** QR içeriği yalnızca `https://smartwayavm.com/r/{mall_slug}/{code}` formatında sabit bir URL'dir; service worker bu path'i önbellekten çözebilir, node/graf verisi cihazda yoksa dahi kod bilgisi (kat + tip) offline gösterilebilir, tam rota ise senkron olunca hesaplanır.

---

## 8. Reklam Platformu

### 8.1 Format Desteği

Banner, Video, Carousel, GIF, HTML5, Popup, Interstitial (geçiş ekranı), Reward (ödüllü reklam — örn. "reklamı izle, kupon kazan"), Native (arama sonuçlarına gömülü, "sponsorlu" etiketli).

### 8.2 Sponsorluk Envanteri (Google Ads mantığına paralel, mekâna özel genişletme)

| Envanter Tipi | Açıklama | Tablo/Alan |
|---|---|---|
| Harita İçi Sponsor | Kat planında öne çıkan/vurgulanmış mağaza ikonu | `ads.target_floor_id` + öncelik |
| Kategori Sponsorluğu | Belirli kategori aramalarında öncelikli gösterim | `ads.target_categories` |
| Mağaza Sponsorluğu | Rakip mağaza sayfası ziyaret edildiğinde ilgili reklam | `ads` + `slot=store_detail` |
| Arama Sponsorluğu | Arama sonuç listesinde "sponsorlu" ilk sırada | `ads` + `slot=search_inline` |
| Rota Sponsorluğu | Rota tamamlandığında hedeflenmiş reklam | `ads` + `slot=route_complete` |

Bu 5 envanter tipi zaten `ad_slots` + `ads.target_categories/target_floor_id` alanlarıyla şemada karşılanmaktadır; Faz 2'de `ad_slots` tablosuna sabit kayıtlar (`home_top`, `search_inline`, `map_banner`, `store_detail`, `campaign_page`, `route_complete`, `exit_screen`) seed edilecektir.

### 8.3 Akıllı Hedefleme

Kural tabanlı hedefleme (Faz 1): kategori + kat + zaman aralığı eşleştirmesi (`backend/routes/stores.js` içindeki `/api/ads` uç noktasında uygulanmıştır). Faz 3'te AI destekli davranışsal hedefleme eklenecek (Bölüm 10).

### 8.4 Raporlama

`ad_events` tablosu her impression/click'i kaydeder. Hesaplanacak temel metrikler:

- **Gösterim (Impression)** — `event_type='impression'` sayısı
- **Tıklama (Click)**
- **CTR** = click / impression
- **Dönüşüm** — kuponu kullanan/kampanya sayfasına giden oranı (Faz 2'de `conversion` event tipi eklenecek)

Bu metrikler AVM Yönetim Paneli'nde reklamveren bazlı, mağaza yöneticisi kendi kampanyası bazlı görebilecek şekilde ayrı yetki seviyelerinde sunulacaktır.

---

## 9. Kampanya Platformu

| Özellik | Açıklama | Durum |
|---|---|---|
| Mağaza kampanyaları | Süreli indirim/banner/video/kupon | Faz 1 — şemada mevcut (`campaigns`) |
| AVM kampanyaları | Tüm AVM'yi kapsayan duyuru/etkinlik | Faz 1 — (`mall_popups`) |
| Kategori kampanyaları | "Tüm ayakkabı mağazalarında %20" gibi çoklu mağaza kampanyası | Faz 2 — `campaign_categories` join tablosu eklenecek |
| Sponsorlu kampanyalar | Reklam bütçesiyle öne çıkarılan kampanya | Faz 2 — `campaigns.boosted_ad_id` |
| QR Kupon | Fiziksel QR okutarak kupon kazanma | Faz 1 — `campaigns.qr_coupon` |
| Sadakat / puan sistemi | Ziyaret/alışveriş bazlı puan biriktirme | Faz 3 — `loyalty_points`, `loyalty_transactions` |
| Dijital hediye çeki | Elektronik olarak iletilen hediye çeki | Faz 3 |
| Dijital çekiliş | Katılım + kura + kazanan bildirimi | Faz 3 — `raffles`, `raffle_entries` |

---

## 10. Yapay Zeka Özellikleri

AI yalnızca doğal dil aramasıyla sınırlı tutulmayacak; aşağıdaki alanlarda kademeli olarak devreye alınacaktır:

| Alan | Yaklaşım | Faz |
|---|---|---|
| Doğal dil mağaza araması | LLM tabanlı niyet çözümleme → kategori/mağaza eşleştirme | Faz 2 |
| Mağaza/kampanya önerisi | Arama geçmişi + kategori benzerliğine dayalı basit öneri motoru (kural + istatistiksel), sonra collaborative filtering | Faz 2 → Faz 3 |
| Reklam hedefleme | Kural tabanlı (Faz 1) → davranışsal skor modeli (Faz 3) | Faz 1 / Faz 3 |
| Yoğunluk analizi & ısı haritası | `route_logs`/`search_logs` agregasyonu, saatlik/katlık yoğunluk | Faz 2 |
| Rota önerisi (alternatif güzergah) | Yoğunluk verisiyle ağırlıklandırılmış edge maliyeti ("sessiz rota") | Faz 3 |
| En uygun mağaza önerisi | Kullanıcı niyeti + mesafe + kampanya varlığı skorlaması | Faz 2 |
| Boş otopark önerisi | Otopark doluluk sensör/QR verisiyle (donanım entegrasyonuna bağlı) | Faz 4 |
| Satış/ziyaretçi davranışı raporu | Otomatik haftalık/aylık özet rapor üretimi (LLM ile doğal dil özetleme) | Faz 3 |

**Not:** Faz 1'de AI kapsamı bilinçli olarak dar tutulur (yalnızca temel doğal dil eşleştirme, kural tabanlı hedefleme); bu, erken aşamada gereksiz karmaşıklık ve maliyetten kaçınmak içindir. AI modülü, diğer modüllerden bağımsız bir servis olarak tasarlanmıştır (Bölüm 3) — böylece model/sağlayıcı değişse dahi çekirdek sistem etkilenmez.

---

## 11. Dijital Signage Entegrasyonu

İleride AVM içi ekranlarla entegrasyon için planlanan modül kapsamı:

- **Ekran Yönetimi:** Her fiziksel ekran bir `signage_devices` kaydına sahip olur (konum, çözünürlük, yönlendirme).
- **İçerik Zamanlama:** `signage_playlists` ile saat/gün bazlı içerik sırası tanımlanır (reklam, kampanya, AVM duyurusu, kat planı döngüsü).
- **Kiosk Modu:** Ziyaretçi PWA'sının tam ekran, dokunmatik-optimize, zaman aşımında ana ekrana dönen (idle timeout) özel bir modu.
- **Dokunmatik Ekran Modu:** Büyük hedef alanlı UI varyantı, düşük mesafeden okunabilir tipografi (frontend-design ilkeleriyle ayrı bir tema paketi).
- **Uzaktan yönetim:** Socket.IO üzerinden ekranlara canlı içerik push edilebilmesi (örn. acil duyuru anında tüm ekranlara yayılır).

Bu modül Faz 4'te ele alınacak; ancak veri modeli (playlist/device ayrımı) API-first ilkesiyle şimdiden Bölüm 3'teki modül listesine dahil edilmiştir ki ileride mevcut mimariye organik şekilde oturabilsin.

---

## 12. Mobil / PWA / Offline

- **PWA:** `manifest.json` + service worker ile ana ekrana eklenebilir, tam ekran deneyim.
- **Offline çalışma stratejisi:**
  - App shell (HTML/CSS/JS) — cache-first.
  - Aktif AVM'nin kat planları (SVG) + graf verisi (node/edge) + mağaza listesi — stale-while-revalidate, arka planda periyodik senkron.
  - QR çözümleme — QR, node kodu barındırdığı için offline'da da bilinir; rota hesaplaması istemci tarafı `NavGraph` modülüyle (Bölüm 6.2) tamamen offline yürütülebilir.
  - Kampanya/reklam görselleri — offline'da en son senkronize edilen içerik gösterilir; internet geldiğinde arka planda güncellenir.
- **Senkronizasyon:** Background Sync API ile, internet geldiğinde bekleyen analitik olayları (arama/rota logları) sunucuya toplu gönderilir.
- **Push bildirim:** Web Push (VAPID) ile — favori mağaza kampanyası, AVM etkinliği bildirimleri.

---

## 13. Güvenlik

OWASP Top 10 ve genel SaaS güvenlik standartlarına uyum:

| Alan | Uygulama |
|---|---|
| Kimlik doğrulama | JWT access (kısa ömürlü) + refresh token (rotasyonlu), şifreler `bcrypt`/`argon2` ile hash'lenir |
| Yetkilendirme (RBAC) | `super_admin` / `mall_admin` / `store_manager` rolleri, middleware seviyesinde kaynak-bazlı kontrol |
| Tenant izolasyonu | Uygulama katmanında zorunlu `mall_id` filtresi + Faz 2'de PostgreSQL RLS ile ikinci savunma katmanı |
| Rate limiting | IP ve token bazlı, Redis destekli dağıtık sayaç |
| CSRF | SameSite cookie + CSRF token (form tabanlı admin işlemlerinde) |
| XSS | Kullanıcı girdisi (mağaza açıklaması, kampanya metni) sunucu tarafında sanitize edilir, çıktı encode edilir |
| SQL Injection | Parametreli sorgular (zaten `pg` ile `$1,$2...` kullanılıyor), ORM/query builder değerlendirilecek |
| Şifreleme | Aktarımda TLS 1.2+, hassas alanlar (ödeme bilgisi vb.) at-rest şifreleme, sırlar (secrets) vault/ortam değişkeninde |
| Audit log | Bölüm 5.1'de tanımlı değişmez kayıt |
| Bağımlılık taraması | CI'da otomatik `npm audit` / Dependabot |
| Gizlilik | KVKK (Türkiye) ve ileride GDPR uyumluluğu — ziyaretçi analitiği anonimleştirilmiş `session_id` ile tutulur, kişisel veri asgari düzeyde toplanır |

---

## 14. Performans ve Ölçeklenebilirlik

**Hedef ölçek:** 100 AVM · 10.000 mağaza · eşzamanlı 1.000.000 ziyaretçi (toplam platform, tek AVM'de eşzamanlı değil).

| Önlem | Açıklama |
|---|---|
| Yatay ölçekleme | Stateless API katmanı — birden çok Node.js instance, load balancer arkasında |
| Veritabanı | Bağlantı havuzu (zaten `pg.Pool`), okuma replikaları (Faz 3), gerekirse `mall_id` bazlı sharding (Faz 4, yalnızca gerçekten gerekirse) |
| Cache | Sık değişmeyen veri (kat planı, graf, mağaza listesi) Redis'te AVM bazlı önbelleklenir; TTL + yayınlama sırasında invalidation |
| Route engine performansı | Graf, AVM başına genelde birkaç yüz node — A*/Dijkstra milisaniyeler içinde çözülür; sonuçlar kısa süreli (örn. 60 sn) cache'lenebilir |
| CDN | Medya ve statik varlıklar CDN üzerinden, API sunucusuna yük bindirmez |
| Asenkron işler | Rapor üretimi, toplu QR PDF üretimi, push bildirim gönderimi kuyruğa alınır (BullMQ), API isteğini bloklamaz |
| Yük testi | Faz 2 sonunda k6/Artillery ile hedef ölçeğin simülasyonu, darboğaz tespiti |
| Gözlemlenebilirlik | Prometheus metrikleri (p50/p95/p99 gecikme, hata oranı) ile erken uyarı |

---

## 15. Yol Haritası (Fazlar)

Her faz sonunda **çalışan, teslim edilebilir bir ürün** ortaya çıkar.

### Faz 1 — MVP: Tek AVM'de Çalışan Çekirdek Ürün
- Multi-tenant veritabanı şeması (uygulandı)
- Route Engine (A*/Dijkstra, kat geçişi, erişilebilirlik tercihi) (uygulandı)
- QR çözümleme, arama, rota API'leri (uygulandı — `navigation.js`, `stores.js`)
- Ziyaretçi PWA: SVG harita, arama, animasyonlu rota, mağaza detay sayfası, kampanya rozetleri, AVM popup
- Temel reklam gösterimi (kural tabanlı hedefleme)
- Temel analitik loglama (arama/rota)
- **Çıktı:** Tek bir demo AVM'de uçtan uca çalışan, satışa gösterilebilir ürün.

### Faz 2 — Yönetim Panelleri + Çoklu AVM
- AVM Yönetim Paneli: kat/SVG yükleme-düzenleme, QR toplu üretim/yazdırma, kampanya/popup/reklam yönetimi, temel analitik dashboard
- Mağaza Paneli: profil, kampanya/kupon self-servis, kendi istatistikleri
- Super Admin Paneli: çoklu AVM onboarding, plan/lisans, fatura
- RBAC + Audit Log
- Kategori kampanyaları, sponsorlu kampanya
- Isı haritası, yoğunluk analitiği
- **Çıktı:** Birden fazla AVM'yi tek platformdan yöneten, satış ekibinin bağımsız demo/onboarding yapabildiği ürün.

### Faz 3 — Akıllılaştırma ve Gelir Derinleştirme
- AI destekli doğal dil arama ve öneri motoru
- Davranışsal reklam hedefleme
- Sadakat/puan sistemi, dijital çekiliş, hediye çeki
- Offline-first PWA geliştirmeleri (arka plan senkron, push bildirim)
- "Sessiz rota" (yoğunluk-farkında rota önerisi)
- Çoklu dil tam kapsam (TR/EN/AR/RU/DE)
- **Çıktı:** Rakiplerin sunmadığı AI + reklam derinliği ile farklılaşan, uluslararası genişlemeye hazır ürün.

### Faz 4 — Kurumsal Ölçek ve Genişleme
- Dijital Signage / Kiosk modülü
- PDR (adım sayar + jiroskop) ile QR-sonrası yaklaşık konum takibi
- Opsiyonel BLE beacon paketi (premium plan)
- Okuma replikaları, gerekirse modül bazlı mikroservis ayrıştırması (özellikle Route Engine, Advertising)
- Üçüncü parti API/webhook ekosistemi, entegratör ortaklıkları
- **Çıktı:** 100+ AVM ölçeğinde, kurumsal zincirlere satılabilir, uluslararası pazara açık platform.

---

## Onay

Bu doküman, geliştirmeye başlamadan önce gözden geçirilmek üzere hazırlanmıştır. Onayınızın ardından Faz 1 kapsamındaki bileşenler (çekirdek backend + Ziyaretçi PWA) üzerinde kodlama çalışmasına devam edilecektir.
