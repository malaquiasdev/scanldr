# scanldr — Technical Summary

This document is the central index of all technical documentation for **scanldr**. It covers everything from high-level architecture to detailed flow diagrams.

## Overview
- [System Overview](architecture_c4.md)

## Architecture Decision Records (ADRs)
- [ADR-001: Cookie Replay over Playwright Stealth](adr/001-cookie-replay-strategy.md)
- [ADR-002: MangaDex as Primary Metadata and Download Source](adr/002-mangadex-primary-source.md)
- [ADR-002: Manual Cookie Paste (supersedes ADR-001 auth mechanism)](adr/002-manual-cookie-paste.md)
- [ADR-003: SQLite for Download History](adr/003-sqlite-download-history.md) _(superseded by ADR-006)_
- [ADR-004: Subscriptions Stored in SQLite](adr/004-subscriptions-in-sqlite.md) _(withdrawn)_
- [ADR-006: Trace store as state, with TTL retention](adr/006-trace-store-as-state-with-ttl.md)

## Historical Flows (pre-epic #116)

> These flows describe commands (`download`, `list`, `sync`, `update`) removed in epic #116. Kept as historical record.

- [Authentication Flow (Cloudflare bypass)](flows/auth_flow.md)
- [List Flow](flows/list_flow.md)
- [Download Flow](flows/download_flow.md)
- [Update Flow](flows/update_flow.md)
- [Sync Flow](flows/sync_flow.md)

## Historical Overview (pre-epic #116)

- [System Overview](overviewer.md) _(pre-epic #116 — historical record)_

## Historical Data Models (pre-epic #116)

> These models describe tables (`downloads`, `subscriptions`) dropped in epic #116 Phase 4. Kept as historical record.

- [Auth & Session Model](models/auth_model.md)
- [Manga & Chapter Model](models/manga_model.md)
- [History Model](models/history_model.md)
- [Subscription Model](models/subscription_model.md)

## CI/CD
- [Quality & Security Stack](ci-cd.md)

## Technical Standards
- **Runtime:** Bun
- **Language:** TypeScript
- **Auth:** manual cURL paste from the user's real browser via DevTools (`parseCurl` in `src/plugins/auth-path/`)
- **Metadata source:** MangaDex API
- **Output formats:** CBZ / ZIP (via `src/pack/`)
- **Persistent state:** SQLite `traces` table only — 3-day TTL, one row per log event (`src/plugins/trace/`)
- **CLI entrypoint:** `bun start` → single one-shot walkthrough (`src/walkthrough/`)
- **Supported sources:** MangaDex (primary), mangakakalot.gg (fallback), others to be added

---
*To propose changes to this documentation, open an Issue with the label `docs`.*
