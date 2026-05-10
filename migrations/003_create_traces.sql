CREATE TABLE IF NOT EXISTS traces (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL,
  level       TEXT    NOT NULL,
  event       TEXT,
  msg         TEXT    NOT NULL,
  fields_json TEXT,
  run_id      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS traces_ts_idx ON traces(ts);
