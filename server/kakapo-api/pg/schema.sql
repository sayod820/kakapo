-- KAKAPO — PostgreSQL storage for API (JSONB collections)
-- Replaces kakapo.json while keeping the same in-memory API shape.

CREATE TABLE IF NOT EXISTS kv_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS docs (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data JSONB NOT NULL,
  sort_idx INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS docs_collection_sort_idx
  ON docs (collection, sort_idx);

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO schema_meta (key, value)
VALUES ('version', '1')
ON CONFLICT (key) DO NOTHING;
