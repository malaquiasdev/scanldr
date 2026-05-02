# Model — Subscriptions (Watchlist)

Subscriptions are the list of manga the user wants `sync` to keep up to date. Stored in `scanldr.db` (SQLite) alongside the download history. There is no plain-text `mangas.txt` — the database is the single source of truth.

For users migrating from a flat list, `scanldr import <file>` and `scanldr export` provide one-shot conversions.

## Schema

```sql
CREATE TABLE IF NOT EXISTS subscriptions (
  source          TEXT    NOT NULL,     -- "mangadex" | "mangakakalot" | ...
  manga_id        TEXT    NOT NULL,     -- MangaDex UUID or site slug
  manga_title     TEXT    NOT NULL,     -- last-known display title (refreshed on sync)
  paused          INTEGER NOT NULL DEFAULT 0,  -- 0 = active, 1 = skipped by sync
  added_at        INTEGER NOT NULL,     -- Unix timestamp (ms)
  last_synced_at  INTEGER,              -- Unix timestamp (ms) of the last successful sync run
  PRIMARY KEY (source, manga_id)
);
```

Language is **not** stored per-subscription. All entries use `preferred_languages` from `scanldr.json`. If that needs to differ per-manga in the future, add the column then — not now.

## TypeScript Interface

```ts
interface Subscription {
  source: string;
  mangaId: string;
  mangaTitle: string;
  paused: boolean;
  addedAt: number;
  lastSyncedAt: number | null;
}
```

## CLI Commands

| Command | Description |
|---|---|
| `scanldr watch <manga> [--source <s>]` | Resolve title, add to subscriptions. Default source: `mangadex`. |
| `scanldr unwatch <manga> [--source <s>]` | Remove subscription. Does **not** touch download history. |
| `scanldr watchlist` | List all active subscriptions in a table (title, source, paused, last sync). |
| `scanldr watchlist --paused` | Include paused entries. |
| `scanldr pause <manga>` / `scanldr resume <manga>` | Toggle the `paused` flag. Paused entries are skipped by `sync`. |
| `scanldr import <file>` | Read a flat-text watchlist (one manga per line, `#` comments) and resolve each entry against MangaDex, inserting into `subscriptions`. |
| `scanldr export [--out <file>]` | Dump active subscriptions as plain text (one entry per line). Output goes to stdout if `--out` is omitted. |

## Key Queries

**List active subscriptions:**
```sql
SELECT source, manga_id, manga_title, last_synced_at
FROM subscriptions
WHERE paused = 0
ORDER BY manga_title;
```

**Mark a sync run successful:**
```sql
UPDATE subscriptions
   SET last_synced_at = ?
 WHERE source = ? AND manga_id = ?;
```

## Notes

- Subscriptions and download history (`downloads` table) are **decoupled**: unwatching a manga keeps its history rows; deleting history rows keeps the subscription. The user can prune either independently.
- `manga_title` is refreshed opportunistically — every successful sync writes back the latest title from MangaDex/fallback so renames propagate.
- `last_synced_at` is updated even when no new chapters were downloaded — it records the last *check*, not the last *download*. Combine with `downloads.downloaded_at` to distinguish "checked but nothing new" from "actively downloading".
- Bootstrapping from `mangas.txt`: `scanldr import` resolves each line to `(source, manga_id)` via MangaDex search (or URL parse for fallback URLs) and inserts. Lines that fail to resolve are reported and skipped — the import is not transactional.
