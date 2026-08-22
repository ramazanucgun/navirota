-- backend/db/schema_v7.sql
-- Faz 8 — Ölçeklenebilirlik: Arama İndeksleme
--
-- routes/navigation.js'teki `s.name ILIKE '%' || $2 || '%'` sorgusu baştan
-- joker karakterli (leading-wildcard) bir desendir — standart bir B-Tree
-- indeks bunu KULLANAMAZ, PRD Faz 1'de vaat edilen (ama daha önce hiç
-- uygulanmayan) pg_trgm bu deseni destekleyen bir GIN indeksi sağlar.
-- Mağaza sayısı arttıkça (yüzlerce/binlerce) bu, tam tablo taramasından
-- indeks taramasına geçişi sağlar.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_stores_name_trgm ON stores USING gin (name gin_trgm_ops);
