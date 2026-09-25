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

-- L10: sync_changes is the durable authoritative journal for v2 when DATABASE_URL is set.
-- Retention: ~90 days by time (preferred). Row cap must cover 90d at ~50k events/day
-- (≥4.5M rows) — do NOT use 500k as primary bound (~10 days only).
CREATE TABLE IF NOT EXISTS sync_changes (
  change_seq BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  revision BIGINT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NULL,
  source_client_ref TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_changes_seq_idx ON sync_changes (change_seq);
CREATE INDEX IF NOT EXISTS sync_changes_entity_seq_idx ON sync_changes (entity_type, change_seq);
CREATE INDEX IF NOT EXISTS sync_changes_entity_id_idx ON sync_changes (entity_type, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS sync_changes_idempotency_idx
  ON sync_changes (source_client_ref, entity_type, entity_id, action)
  WHERE source_client_ref IS NOT NULL AND source_client_ref <> '';

-- L10 retention note: keep ~90 days of events (do NOT use 500k row cap as primary —
-- at ~50k events/day that is only ~10 days). Prefer time-based prune jobs.

-- API sessions survive restarts. Only sha256(token) is stored, never the token itself.
CREATE TABLE IF NOT EXISTS api_sessions (
  token_hash TEXT PRIMARY KEY,
  principal TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_sessions_expires_idx ON api_sessions (expires_at);
