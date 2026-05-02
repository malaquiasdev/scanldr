# ADR-003: SQLite for Download History

**Date:** 2026-04-24
**Status:** Accepted

## Context

The user downloads complete volumes and then deletes the `.cbz` files after reading to free up disk space. The `update` and `sync` commands need to know what has already been downloaded to avoid re-downloading. The output directory cannot be used as the source of truth because the files may have been deleted.

A persistent, disk-based history is required that survives output directory cleanup.

## Decision

Use **SQLite via `bun:sqlite`** to persist download history in `scanldr.db` at the project root.

## Justification

### Why not a JSON file?

A JSON file grows unbounded and requires reading + parsing the entire file on every check. SQLite allows indexed lookups (`WHERE manga_id = ? AND volume = ?`) with no full-scan overhead.

### Why `bun:sqlite` over an ORM or external library?

`bun:sqlite` is built into Bun — zero extra dependencies, zero install step, native performance. The schema is simple enough that raw SQL is cleaner than an ORM abstraction.

### Why not check the filesystem?

The user explicitly cleans the output directory after reading. Filesystem checks would re-download everything after each cleanup cycle, defeating the purpose.

### Why per-chapter records instead of per-volume?

Granular records allow partial re-downloads (e.g., if a chapter failed mid-volume), and make the unique constraint (`manga_id, chapter_id, source, language`) straightforward.

## Consequences

### Positive

- `update` and `sync` remain accurate even after the user deletes output files.
- Zero extra dependencies — `bun:sqlite` is native.
- Queryable: `scanldr history` can display filtered, sorted views.
- Idempotent: the unique index prevents duplicate records.

### Negative

- `scanldr.db` must be backed up if the user wants to preserve history across machines.
- If the user deletes `scanldr.db`, history is lost and `update`/`sync` will re-download everything.
- `--force` must explicitly bypass the history check to force a re-download.
