-- backend/db/schema_v5.sql
-- Faz 5 — Güvenlik Sertleştirme
-- Bu dosya idempotent'tir (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), her
-- deploy'da tekrar çalıştırılabilir (bkz. db/migrate.js).

-- ---------------------------------------------------------------------
-- REFRESH TOKEN ROTASYONU
-- Her /api/auth/refresh çağrısında eski token iptal edilip yenisi
-- verilir (rotation). Eğer daha önce iptal edilmiş (rotasyona uğramış)
-- bir token tekrar kullanılmaya çalışılırsa, bu bir token hırsızlığı
-- işareti sayılır ve kullanıcının TÜM oturumları iptal edilir
-- (reuse detection). `replaced_by` bu zinciri izlemek için kullanılır.
-- ---------------------------------------------------------------------
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS replaced_by UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR(40); -- 'rotated' | 'logout' | 'reuse_detected' | 'password_reset'

-- ---------------------------------------------------------------------
-- PAROLA SIFIRLAMA
-- Tek kullanımlık, 1 saat geçerli, hash'lenmiş token. Ham değer yalnızca
-- e-postada gönderilir, veritabanında hiç saklanmaz (refresh_tokens ile
-- aynı desen).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);

-- audit_log.action önceden VARCHAR(20) idi ('create'/'update'/'delete'/'login'
-- gibi kısa değerler için yeterliydi); bu fazda eklenen
-- 'password_reset_requested', 'refresh_token_reuse_detected' gibi daha
-- açıklayıcı eylem adları bu sınırı aşıyor, bu yüzden genişletiliyor.
ALTER TABLE audit_log ALTER COLUMN action TYPE VARCHAR(50);
