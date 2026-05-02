# Model — Download History

Persisted in `scanldr.db` (SQLite) via `bun:sqlite`. Lives in the project root alongside `.scanldr-auth.json`.

The history is the single source of truth for "what has been downloaded". It is intentionally decoupled from the output directory — the user can delete `.cbz` files freely and the CLI will not re-download them.

## Schema

```sql
CREATE TABLE IF NOT EXISTS downloads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  manga_id      TEXT    NOT NULL,  -- MangaDex UUID or site slug
  manga_title   TEXT    NOT NULL,
  volume        TEXT    NOT NULL,  -- volume number as string ("3", "none")
  chapter_id    TEXT    NOT NULL,  -- chapter ID from source
  chapter_num   TEXT    NOT NULL,  -- chapter number as string ("18", "18.5")
  source        TEXT    NOT NULL,  -- "mangadex" | "mangakakalot" | ...
  language      TEXT    NOT NULL,  -- BCP 47 code ("en", "pt-BR")
  downloaded_at INTEGER NOT NULL   -- Unix timestamp (ms)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_chapter
  ON downloads (manga_id, chapter_id, source, language);
```

## TypeScript Interface

```ts
interface DownloadRecord {
  id: number;
  mangaId: string;
  mangaTitle: string;
  volume: string;
  chapterId: string;
  chapterNum: string;
  source: string;
  language: string;
  downloadedAt: number;
}
```

## Key Queries

**Check if a volume is fully downloaded:**
```sql
SELECT COUNT(*) FROM downloads
WHERE manga_id = ? AND volume = ? AND language = ?;
```

**List all downloaded volumes for a manga:**
```sql
SELECT DISTINCT volume FROM downloads
WHERE manga_id = ? AND language = ?
ORDER BY CAST(volume AS REAL);
```

**Full history for display:**
```sql
SELECT manga_title, volume, source, language, downloaded_at
FROM downloads
ORDER BY manga_title, CAST(volume AS REAL);
```

## Notes

- The unique index on `(manga_id, chapter_id, source, language)` prevents duplicate records even if `scanldr download` is run twice.
- The history is **decoupled from the filesystem** (ADR-003). The CLI does not verify that `.cbz` files still exist on disk — the user is free to delete them. If a `.cbz` is corrupted and the user wants it back, `scanldr download --force` re-downloads regardless of history.
- `--no-track` disables history writes for a single run without modifying the database.
- `--force` bypasses the history check and re-downloads, updating `downloaded_at` on completion.
- `--dry-run` never writes to the history.
- `scanldr.db` must be backed up if the user wants to preserve history across machines. If deleted, `update`/`sync` will re-download everything.
