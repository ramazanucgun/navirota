-- backend/db/schema_v6.sql
-- Faz 6 — Ödeme / Abonelik (iyzico)
-- İdempotent (ADD COLUMN IF NOT EXISTS), her deploy'da tekrar çalıştırılabilir.

-- Mevcut `invoices` tablosu (schema.sql) yalnızca mall_id/amount/status/
-- period_start/period_end/paid_at içeriyordu. Bir ödeme sağlayıcısıyla
-- entegre olabilmek için hangi plana, hangi provider işlemine karşılık
-- geldiğini izleyecek kolonlar eklendi.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'iyzico';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(100);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS checkout_token TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS provider_payment_id VARCHAR(100);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS failure_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_conversation ON invoices(conversation_id);
-- Bir checkout_token yalnızca bir invoice'a ait olmalı (callback'te token
-- ile invoice'ı bulup güncelliyoruz); NULL'lar (henüz token dönmemiş
-- pending kayıtlar) bu kısıtlamadan muaftır.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_checkout_token ON invoices(checkout_token) WHERE checkout_token IS NOT NULL;

-- Aktif aboneliğin bir sonraki yenilenme/bitiş tarihi. trial_ends_at zaten
-- vardı (deneme süresi); bu, ÖDENMİŞ bir dönemin ne zaman biteceğini tutar.
ALTER TABLE malls ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
