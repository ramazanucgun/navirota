-- =====================================================================
-- SmartWay AVM — Faz 2 Şema Eklentileri
-- Uygulama: psql "$DATABASE_URL" -f db/schema_v2.sql   (schema.sql'den SONRA çalıştırılır)
-- =====================================================================

-- ---------------------------------------------------------------------
-- AUDIT LOG — değişmez (append-only) kayıt. Kim/ne/ne zaman değiştirdi.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role      VARCHAR(30),
    mall_id         UUID REFERENCES malls(id) ON DELETE CASCADE,
    entity          VARCHAR(60) NOT NULL,   -- 'campaign','ad','floor','store', ...
    entity_id       UUID,
    action          VARCHAR(20) NOT NULL,   -- 'create'|'update'|'delete'|'login'
    diff            JSONB,
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_mall_time ON audit_log(mall_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

-- ---------------------------------------------------------------------
-- REFRESH TOKEN — rotasyonlu, iptal edilebilir oturumlar için
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

-- ---------------------------------------------------------------------
-- KATEGORİ KAMPANYALARI — "Tüm ayakkabı mağazalarında %20" gibi
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS category_campaigns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mall_id         UUID NOT NULL REFERENCES malls(id) ON DELETE CASCADE,
    category_id     UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    discount_percent NUMERIC(5,2),
    banner_url      TEXT,
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_category_campaigns_mall ON category_campaigns(mall_id) WHERE is_active = true;

-- Sponsorlu kampanya: bir mağaza kampanyası, reklam bütçesiyle öne çıkarılabilir
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS is_boosted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS boost_priority INTEGER NOT NULL DEFAULT 0;

-- Soft delete desteği (Faz 2 ilkesi — geri alınabilirlik)
ALTER TABLE stores    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE ads       ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Kat planı versiyonlama (Faz 2)
CREATE TABLE IF NOT EXISTS floor_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    floor_id        UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
    svg_url         TEXT,
    nodes_snapshot  JSONB,
    edges_snapshot  JSONB,
    published_by    UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_floor_versions_floor ON floor_versions(floor_id, created_at DESC);
