# ADR-004: Subscriptions Stored in SQLite, Not a Flat-Text File

**Date:** 2026-05-01
**Status:** Accepted
**Supersedes:** the `mangas.txt` design referenced by earlier drafts of `flows/sync_flow.md` and `overviewer.md`.

## Context

`sync` needs a list of manga the user wants to keep updated (a "watchlist"). The first draft of scanldr stored this list in a plain-text `mangas.txt` at the project root. ADR-003 already established `scanldr.db` (SQLite) as the source of truth for download history.

Having two persistence formats — flat text for the watchlist, SQLite for history — creates two problems:

1. **No place to attach per-entry metadata.** A user may want to override the preferred language for a specific manga, mark a series as paused, or record when each entry was last successfully synced. A line of text cannot carry that without re-inventing a serialization format.
2. **Risk of divergence.** The text file references manga by slug or URL while history references them by `manga_id` (MangaDex UUID or site slug). Reconciling the two on every run adds error-prone glue code.

## Decision

Store the watchlist in a `subscriptions` table inside the same `scanldr.db`. The table is keyed by `(source, manga_id)` and holds the per-entry metadata required by `sync`. Add CLI commands `watch`, `unwatch`, `watchlist`, `pause`, `resume`, `import`, and `export` to manage entries without manual file editing.

Do **not** keep `mangas.txt` as a parallel source of truth. Provide one-shot `import` / `export` commands purely as a migration / portability convenience.

## Justification

### Why SQLite?

- It is already a hard dependency (ADR-003 — download history). No new format, no new file.
- Per-entry metadata fits naturally in columns: `preferred_language`, `paused`, `last_synced_at`.
- Queryable: "which subscriptions haven't synced in 7 days?" is a `WHERE` clause, not a script.
- Atomic edits via the CLI eliminate the "I edited the wrong line" failure mode of hand-curated text files.

### Why not keep `mangas.txt` as well?

- Two sources of truth means rules for which one wins on conflict. There is no acceptable rule that doesn't either silently lose user edits or silently override the database.
- Versioning the file in git was the main upside, but a periodic `scanldr export` covers that use case without making it the canonical store.

### Why `import` / `export`?

- Existing users may already have a `mangas.txt`. `import` makes migration a single command rather than a manual re-add of every entry.
- Plain-text export remains useful for sharing watchlists, diffing across machines, or scripting outside the CLI.

### Composite primary key `(source, manga_id)`

A manga can exist in both MangaDex and a fallback site under different IDs. The user may legitimately subscribe to the same title on both sources (e.g., MangaDex for one language, fallback for another). The composite key models this without forcing the user into a fictitious "canonical" id.

## Consequences

### Positive

- Single persistence format. Backups, migrations, and corruption recovery target one file.
- Per-entry overrides (language, source, paused) become first-class without bespoke parsers.
- `sync` summaries can show "last synced 3 days ago" by reading `last_synced_at` directly.
- CLI is the only API surface for editing the list — encourages users to use commands that validate input (e.g., resolving titles against MangaDex at `watch` time).

### Negative

- Editing the watchlist now requires the CLI; you cannot just open a text file and add a line. Mitigated by `import` / `export`.
- Backups must include `scanldr.db` (already true for history — no new backup scope).
- Migration step needed for any existing user with a `mangas.txt`. Mitigated by `scanldr import mangas.txt`.

## Implementation Notes

- `scanldr import <file>` resolves each line to `(source, manga_id)` via MangaDex search (or by parsing fallback URLs). Lines that fail to resolve are reported and skipped — the import is not transactional, so a single bad line does not block the rest.
- `scanldr unwatch` removes the row from `subscriptions` only. It does **not** touch `downloads`. The user can prune history independently with a separate `scanldr history --prune` command (out of scope for this ADR).
- `manga_title` in the row is refreshed on every successful sync so renames upstream propagate without manual intervention.
