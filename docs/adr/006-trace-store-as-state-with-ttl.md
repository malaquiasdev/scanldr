# ADR-006: Trace store as state, with TTL retention

**Date:** 2026-05-10
**Status:** Accepted

**Related:**
- Supersedes [ADR-003](./003-sqlite-download-history.md)
- Withdraws [ADR-004](./004-subscriptions-in-sqlite.md)
- Implements the logging architecture decision captured in epic #116

## Context

Before Phase 1 of epic #116, scanldr persisted user-facing state in two SQLite tables:

- `downloads` — history of completed chapter downloads, used by `update` and `sync` to skip already-downloaded chapters.
- `subscriptions` — a watchlist of manga the user wanted to keep updated.

The redesign captured in epic #116 dropped both tables in Phase 4. The CLI is now a single one-shot walkthrough (`bun start`); there is no library to manage and no history to track between runs.

However, debug and post-mortem traceability is still required when a download misbehaves. Phase 1 introduced a `traces` table with structured per-event rows:

| Column | Type | Description |
|--------|------|-------------|
| `ts` | TEXT | ISO-8601 timestamp |
| `level` | TEXT | `info`, `warn`, or `error` |
| `event` | TEXT | Structured event key (e.g. `downloader.chapter_start`) |
| `msg` | TEXT | Human-readable message |
| `fields_json` | TEXT | JSON blob of extra structured fields (redacted) |
| `run_id` | TEXT | UUID v4 — unique per CLI invocation |

## Decision

The `traces` table is **the only persistent state** scanldr writes to its SQLite database.

Retention is **3 days**, enforced by an eager `DELETE FROM traces WHERE ts < datetime('now', '-3 days')` that runs whenever the trace store is instantiated (i.e., once per CLI invocation).

Each process gets a unique `run_id` (UUID v4) so traces from a single run can be filtered in isolation.

Redaction (cookies, `cf_clearance`, `useragent`, `authorization`) is applied to `fields_json` before insertion.

The trace store is the **structured sink** for the logger. The **terminal sink stays human-readable** — the partial revert introduced in Phase 1 of epic #116 (partially reverting #99).

## Consequences

### Positive

- No "library state" surface to maintain, migrate, or back up.
- Each run starts from a known baseline; no stale "skip already-downloaded" logic to debug.
- Traces give support and post-mortem visibility for a recent time window.
- Bounded disk footprint (3 days of retention).

### Negative

- User cannot answer "what did I download last month?" — the answer is "look at the output directory".
- Logs that fall outside the 3-day window are gone; reproducing older issues requires the user to have captured logs externally.

### Neutral

- A future `export traces` command (deferred from Phase 1) would let users archive longer windows manually.

## Alternatives Considered

- **Keep `downloads` and `subscriptions`** — rejected. The new walkthrough-centric design removes the library-management surface entirely. See ADR-003 (superseded) and ADR-004 (withdrawn).
- **Retain logs indefinitely** — rejected. Unbounded disk pressure and PII risk (cookies, clearance tokens in fields).
- **File-based NDJSON logs instead of SQLite** — rejected. SQLite is already a hard dependency for traces, and queryability (filter by `run_id`, `level`, `event`) matters for support scenarios.

## Known follow-ups (independent of this ADR)

The following issues capture deferred work that was scoped out of the epic phases but is relevant to the new architecture:

- [#121](https://github.com/malaquiasdev/scanldr/issues/121) — mangadex `feedChapters` pagination.
- [#122](https://github.com/malaquiasdev/scanldr/issues/122) — mangakakalot synthetic chapter num when source returns null.
- [#123](https://github.com/malaquiasdev/scanldr/issues/123) — cover injection in volume mode.
- [#124](https://github.com/malaquiasdev/scanldr/issues/124) — mangadex hardcoded `DEFAULT_CONFIG`.
- A future `export traces` command (deferred from Phase 1).
