CREATE TABLE IF NOT EXISTS source_cache (
  source       TEXT NOT NULL,
  payload_type TEXT NOT NULL,
  key          TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at   TEXT NOT NULL,
  PRIMARY KEY (source, payload_type, key)
);

CREATE INDEX IF NOT EXISTS source_cache_fetched_at_idx ON source_cache(fetched_at);
