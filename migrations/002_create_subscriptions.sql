CREATE TABLE IF NOT EXISTS subscriptions (
  source          TEXT    NOT NULL,
  manga_id        TEXT    NOT NULL,
  manga_title     TEXT    NOT NULL,
  paused          INTEGER NOT NULL DEFAULT 0,
  added_at        INTEGER NOT NULL,
  last_synced_at  INTEGER,
  PRIMARY KEY (source, manga_id)
);
