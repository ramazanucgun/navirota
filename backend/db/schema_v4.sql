-- =====================================================================
-- SmartWay AVM — Faz 4 Şema Eklentileri
-- Uygulama: psql "$DATABASE_URL" -f db/schema_v4.sql   (schema_v3.sql'den SONRA)
-- =====================================================================

-- ---------------------------------------------------------------------
-- DİJİTAL SIGNAGE / KIOSK
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signage_devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,           -- 'Zemin Kat - Ana Giriş Ekranı'
    floor_id        UUID REFERENCES floors(id) ON DELETE SET NULL,
    location_label  VARCHAR(150),                     -- 'Asansör yanı'
    orientation     VARCHAR(10) NOT NULL DEFAULT 'landscape', -- landscape|portrait
    resolution_w    INTEGER DEFAULT 1920,
    resolution_h    INTEGER DEFAULT 1080,
    pairing_code    VARCHAR(8) UNIQUE NOT NULL,        -- kiosk cihazının eşleştirme kodu
    is_kiosk_mode   BOOLEAN NOT NULL DEFAULT true,      -- tam ekran, dokunmatik navigasyon modu
    last_seen_at    TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signage_devices_mall ON signage_devices(mall_id);

CREATE TABLE IF NOT EXISTS signage_playlists (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signage_playlist_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id     UUID NOT NULL REFERENCES signage_playlists(id) ON DELETE CASCADE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    content_type    VARCHAR(20) NOT NULL,               -- 'ad'|'campaign'|'popup'|'custom_media'
    reference_id    UUID,                                 -- ads.id / campaigns.id / mall_popups.id (content_type'a göre)
    media_url       TEXT,                                 -- content_type='custom_media' ise doğrudan URL
    duration_seconds INTEGER NOT NULL DEFAULT 10,
    day_of_week     SMALLINT[],                            -- NULL = her gün; [1,2,3,4,5] = hafta içi (1=Pzt)
    start_hour      SMALLINT,                                -- NULL = tüm gün
    end_hour        SMALLINT
);
CREATE INDEX IF NOT EXISTS idx_signage_items_playlist ON signage_playlist_items(playlist_id, sort_order);

-- Cihaz ↔ playlist ataması (bir cihaz tek playlist oynatır)
ALTER TABLE signage_devices ADD COLUMN IF NOT EXISTS playlist_id UUID REFERENCES signage_playlists(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- ÜÇÜNCÜ PARTİ API ANAHTARLARI (entegratör ekosistemi)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    label           VARCHAR(100) NOT NULL,              -- 'ERP Entegrasyonu', 'CRM Webhook'
    key_prefix      VARCHAR(12) NOT NULL,                 -- görüntülenen kısım: 'sw_live_a1b2'
    key_hash        TEXT NOT NULL,                          -- sha256(tam anahtar)
    scopes          VARCHAR(30)[] NOT NULL DEFAULT ARRAY['read'], -- 'read'|'write'
    last_used_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_mall ON api_keys(mall_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- WEBHOOK ABONELİKLERİ
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhooks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    target_url      TEXT NOT NULL,
    events          VARCHAR(40)[] NOT NULL,               -- 'campaign.created','store.updated','route.completed', ...
    secret          TEXT NOT NULL,                          -- HMAC imzalama için
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id      UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event           VARCHAR(40) NOT NULL,
    payload         JSONB NOT NULL,
    status_code     INTEGER,
    success         BOOLEAN,
    attempted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, attempted_at DESC);

-- ---------------------------------------------------------------------
-- BLE BEACON (opsiyonel donanım paketi — premium plan)
-- Donanım fiziksel olarak mevcut olmasa da veri modeli hazırdır; bir
-- beacon fiziksel olarak kurulduğunda yalnızca bu tabloya kayıt eklenir,
-- route engine ve harita katmanı değişmeden çalışmaya devam eder.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS beacons (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    node_id         UUID REFERENCES nav_nodes(id) ON DELETE SET NULL,
    uuid            VARCHAR(36) NOT NULL,
    major           INTEGER,
    minor           INTEGER,
    battery_level   SMALLINT,
    last_ping_at    TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_beacons_mall ON beacons(mall_id);
