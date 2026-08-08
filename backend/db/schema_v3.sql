-- =====================================================================
-- SmartWay AVM — Faz 3 Şema Eklentileri
-- Uygulama: psql "$DATABASE_URL" -f db/schema_v3.sql   (schema_v2.sql'den SONRA)
-- =====================================================================

-- ---------------------------------------------------------------------
-- ZİYARETÇİ KİMLİĞİ — giriş yapmadan, cihazda kalıcı bir kimlikle
-- sadakat puanı / favoriler / çekiliş katılımı takip edilir.
-- (client localStorage'da üretilen bir UUID; kişisel veri asgari düzeyde:
--  yalnızca mall_id + bu anonim id ile ilişkilendirilir.)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visitors (
    id              UUID PRIMARY KEY,               -- client tarafında üretilir
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    locale          VARCHAR(5) NOT NULL DEFAULT 'tr'
);
CREATE INDEX IF NOT EXISTS idx_visitors_mall ON visitors(mall_id);

-- ---------------------------------------------------------------------
-- SADAKAT / PUAN SİSTEMİ
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_points (
    visitor_id      UUID PRIMARY KEY REFERENCES visitors(id) ON DELETE CASCADE,
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    balance         INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id      UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    delta           INTEGER NOT NULL,               -- + kazanım, - harcama
    reason          VARCHAR(40) NOT NULL,            -- 'qr_coupon'|'route_complete'|'raffle_entry'|'voucher_redeem'
    reference_id    UUID,                             -- ilgili campaign/raffle id
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_visitor ON loyalty_transactions(visitor_id, created_at DESC);

-- Dijital hediye çeki (puan karşılığı)
CREATE TABLE IF NOT EXISTS gift_vouchers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    visitor_id      UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    points_cost     INTEGER NOT NULL,
    value_label     VARCHAR(50) NOT NULL,            -- '50 TL Hediye Çeki'
    redeem_code     VARCHAR(20) UNIQUE NOT NULL,
    redeemed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- DİJİTAL ÇEKİLİŞ
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raffles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    prize_label     VARCHAR(150),
    entry_cost_points INTEGER NOT NULL DEFAULT 0,     -- 0 = ücretsiz katılım
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL,
    drawn_at        TIMESTAMPTZ,
    winner_visitor_id UUID REFERENCES visitors(id),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raffle_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raffle_id       UUID NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
    visitor_id      UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (raffle_id, visitor_id)
);

-- ---------------------------------------------------------------------
-- PUSH BİLDİRİM ABONELİĞİ (Web Push / VAPID)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id      UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    endpoint        TEXT NOT NULL UNIQUE,
    keys_p256dh     TEXT NOT NULL,
    keys_auth       TEXT NOT NULL,
    favorite_store_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_mall ON push_subscriptions(mall_id);

-- ---------------------------------------------------------------------
-- FAVORİLER (push hedeflemesi ve "favorim kampanya yaptı" bildirimleri için)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favorites (
    visitor_id      UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (visitor_id, store_id)
);

-- ---------------------------------------------------------------------
-- Arama loglarına oturum bazlı ilgi profili için kategori sütunu
-- (davranışsal reklam hedeflemesi bu kolonu okur)
-- ---------------------------------------------------------------------
ALTER TABLE search_logs ADD COLUMN IF NOT EXISTS matched_category_code VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_search_logs_session ON search_logs(session_id, searched_at DESC);
