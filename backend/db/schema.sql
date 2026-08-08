-- =====================================================================
-- SmartWay AVM — Veritabanı Şeması (PostgreSQL)
-- Multi-tenant mimari: her AVM (mall) bir "tenant" olarak tek şemada
-- mall_id ile izole edilir (paylaşımlı-şema / row-level multi-tenancy).
-- Bu yaklaşım yüzlerce AVM'ye tek dağıtımla hizmet vermeyi, aynı zamanda
-- gerektiğinde her mall_id için ayrı şemaya/db'ye taşımayı kolaylaştırır.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- SUPER ADMIN / SAAS KATMANI
-- ---------------------------------------------------------------------

CREATE TABLE plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(50) UNIQUE NOT NULL,      -- 'starter','pro','enterprise'
    name            VARCHAR(100) NOT NULL,
    max_stores      INTEGER NOT NULL DEFAULT 50,
    max_floors      INTEGER NOT NULL DEFAULT 5,
    max_admins      INTEGER NOT NULL DEFAULT 5,
    ad_slots_included INTEGER NOT NULL DEFAULT 3,
    monthly_price   NUMERIC(10,2) NOT NULL DEFAULT 0,
    features        JSONB NOT NULL DEFAULT '{}',      -- {"ai_search": true, "heatmap": true, ...}
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE malls (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            VARCHAR(100) UNIQUE NOT NULL,     -- subdomain / tenant key
    name            VARCHAR(200) NOT NULL,
    city            VARCHAR(100),
    address         TEXT,
    timezone        VARCHAR(50) NOT NULL DEFAULT 'Europe/Istanbul',
    default_locale  VARCHAR(5) NOT NULL DEFAULT 'tr',
    supported_locales VARCHAR(5)[] NOT NULL DEFAULT ARRAY['tr','en'],
    logo_url        TEXT,
    theme           JSONB NOT NULL DEFAULT '{}',      -- brand colors, fonts
    plan_id         UUID REFERENCES plans(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'trial', -- trial|active|suspended|cancelled
    trial_ends_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    amount          NUMERIC(10,2) NOT NULL,
    currency        VARCHAR(3) NOT NULL DEFAULT 'TRY',
    status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|paid|failed|refunded
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE support_tickets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    subject         VARCHAR(255) NOT NULL,
    message         TEXT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'open', -- open|in_progress|closed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- KULLANICI / YETKİ KATMANI (AVM yöneticileri, mağaza kullanıcıları)
-- ---------------------------------------------------------------------

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID REFERENCES malls(id) ON DELETE CASCADE, -- null => super_admin
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    full_name       VARCHAR(150),
    role            VARCHAR(30) NOT NULL, -- super_admin|mall_admin|store_manager
    store_id        UUID,                 -- store_manager ise ilgili mağaza
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- KAT PLANI / HARİTA / ROTA GRAFİĞİ
-- ---------------------------------------------------------------------

CREATE TABLE floors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    level_index     INTEGER NOT NULL,        -- -1, 0, 1, 2 ...
    label           VARCHAR(50) NOT NULL,    -- 'Zemin Kat', '1. Kat'
    svg_url         TEXT,                    -- yüklenen kat planı SVG dosyası
    viewbox         VARCHAR(50) NOT NULL DEFAULT '0 0 1000 1000',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (mall_id, level_index)
);

-- Rota grafiğindeki düğümler: koridor kesişimleri, asansör/merdiven girişleri,
-- QR noktaları, mağaza kapı noktaları.
CREATE TABLE nav_nodes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    floor_id        UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
    code            VARCHAR(50) NOT NULL,     -- 'K0-A-05'
    node_type       VARCHAR(20) NOT NULL DEFAULT 'corridor',
                    -- corridor | store_entrance | elevator | escalator | stairs | exit | poi
    x               NUMERIC NOT NULL,         -- SVG koordinatı
    y               NUMERIC NOT NULL,
    linked_group    VARCHAR(50),              -- asansör/merdiven katlar arası eşleşme anahtarı
    accessible       BOOLEAN NOT NULL DEFAULT true, -- tekerlekli sandalye erişimi
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (floor_id, code)
);

-- Düğümler arası kenarlar (yürünebilir yollar). Ağırlık = mesafe/maliyet.
CREATE TABLE nav_edges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_node_id    UUID NOT NULL REFERENCES nav_nodes(id) ON DELETE CASCADE,
    to_node_id      UUID NOT NULL REFERENCES nav_nodes(id) ON DELETE CASCADE,
    weight          NUMERIC NOT NULL DEFAULT 1,
    edge_type       VARCHAR(20) NOT NULL DEFAULT 'walk', -- walk|elevator|escalator|stairs
    bidirectional   BOOLEAN NOT NULL DEFAULT true
);

-- QR kodları, nav_nodes'a bağlıdır (bir QR bir düğümü işaret eder).
CREATE TABLE qr_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    node_id         UUID NOT NULL REFERENCES nav_nodes(id) ON DELETE CASCADE,
    code            VARCHAR(50) UNIQUE NOT NULL,  -- 'K0-A-05' (URL'de kullanılır)
    label           VARCHAR(100),
    printed_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- MAĞAZALAR
-- ---------------------------------------------------------------------

CREATE TABLE categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(50) UNIQUE NOT NULL, -- 'kadin','erkek','ayakkabi','elektronik'...
    name_tr         VARCHAR(100) NOT NULL,
    name_en         VARCHAR(100),
    icon            VARCHAR(50)
);

CREATE TABLE stores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    floor_id        UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
    entrance_node_id UUID REFERENCES nav_nodes(id),
    name            VARCHAR(150) NOT NULL,
    slug            VARCHAR(150) NOT NULL,
    logo_url        TEXT,
    cover_url       TEXT,
    phone           VARCHAR(30),
    website         TEXT,
    description     TEXT,
    opening_hours   JSONB NOT NULL DEFAULT '{}', -- {"mon":"10:00-22:00", ...}
    polygon         JSONB,                       -- SVG polygon points [[x,y],...]
    unit_no         VARCHAR(20),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (mall_id, slug)
);

CREATE TABLE store_categories (
    store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category_id     UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (store_id, category_id)
);

CREATE TABLE store_products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    image_url       TEXT,
    price           NUMERIC(10,2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- KAMPANYA / KUPON
-- ---------------------------------------------------------------------

CREATE TABLE campaigns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    discount_percent NUMERIC(5,2),
    banner_url      TEXT,
    video_url       TEXT,
    cta_label       VARCHAR(50),
    cta_url         TEXT,
    coupon_code     VARCHAR(50),
    qr_coupon       BOOLEAN NOT NULL DEFAULT false,
    badge           VARCHAR(20), -- 'indirim','yeni','hediye'
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- AVM DUYURU / TAM EKRAN POPUP
-- ---------------------------------------------------------------------

CREATE TABLE mall_popups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    title           VARCHAR(200),
    media_type      VARCHAR(20) NOT NULL, -- image|video|gif|html
    media_url       TEXT NOT NULL,
    cta_label       VARCHAR(50),
    cta_url         TEXT,
    show_once_per_session BOOLEAN NOT NULL DEFAULT true,
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- REKLAM YÖNETİMİ
-- ---------------------------------------------------------------------

CREATE TABLE ad_slots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(50) UNIQUE NOT NULL, -- 'home_top','search_inline','map_banner','store_detail','route_complete','exit_screen'
    name            VARCHAR(100) NOT NULL,
    placement_desc  TEXT
);

CREATE TABLE ads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    slot_id         UUID NOT NULL REFERENCES ad_slots(id),
    advertiser_name VARCHAR(150),
    creative_type   VARCHAR(20) NOT NULL, -- banner|video|gif|html5|carousel
    creative_url    TEXT NOT NULL,
    click_url       TEXT,
    target_categories UUID[] DEFAULT ARRAY[]::UUID[], -- akıllı reklam hedefleme -> categories.id
    target_floor_id UUID REFERENCES floors(id),
    priority        INTEGER NOT NULL DEFAULT 0,
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ad_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_id           UUID NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
    event_type      VARCHAR(10) NOT NULL, -- impression|click
    session_id      UUID,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- ZİYARETÇİ OTURUMU / ANALİTİK
-- ---------------------------------------------------------------------

CREATE TABLE visitor_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    entry_qr_code   VARCHAR(50),
    locale          VARCHAR(5) NOT NULL DEFAULT 'tr',
    device_type     VARCHAR(20),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ
);

CREATE TABLE search_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID REFERENCES visitor_sessions(id) ON DELETE SET NULL,
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    query_text      TEXT NOT NULL,
    matched_store_id UUID REFERENCES stores(id),
    searched_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE route_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID REFERENCES visitor_sessions(id) ON DELETE SET NULL,
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    from_node_id    UUID REFERENCES nav_nodes(id),
    to_store_id     UUID REFERENCES stores(id),
    distance        NUMERIC,
    preference       VARCHAR(20) DEFAULT 'shortest', -- shortest|accessible|least_stairs
    completed       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE parking_memory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID REFERENCES visitor_sessions(id) ON DELETE CASCADE,
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    node_id         UUID REFERENCES nav_nodes(id),
    label           VARCHAR(50), -- 'B2 - A Blok - 34'
    photo_url       TEXT,
    saved_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- İNDEKSLER
-- ---------------------------------------------------------------------

CREATE INDEX idx_stores_mall            ON stores(mall_id);
CREATE INDEX idx_stores_floor           ON stores(floor_id);
CREATE INDEX idx_nav_nodes_floor        ON nav_nodes(floor_id);
CREATE INDEX idx_nav_edges_from         ON nav_edges(from_node_id);
CREATE INDEX idx_nav_edges_to           ON nav_edges(to_node_id);
CREATE INDEX idx_campaigns_store_active ON campaigns(store_id) WHERE is_active = true;
CREATE INDEX idx_ads_mall_slot_active   ON ads(mall_id, slot_id) WHERE is_active = true;
CREATE INDEX idx_search_logs_mall_time  ON search_logs(mall_id, searched_at);
CREATE INDEX idx_route_logs_mall_time   ON route_logs(mall_id, created_at);
CREATE INDEX idx_qr_codes_mall          ON qr_codes(mall_id);
