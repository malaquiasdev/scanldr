CREATE TABLE IF NOT EXISTS downloads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  manga_id      TEXT    NOT NULL,
  manga_title   TEXT    NOT NULL,
  volume        TEXT    NOT NULL,
  chapter_id    TEXT    NOT NULL,
  chapter_num   TEXT    NOT NULL,
  source        TEXT    NOT NULL,
  language      TEXT    NOT NULL,
  downloaded_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_chapter
  ON downloads (manga_id, chapter_id, source, language);
