# scanldr — Technical Summary

This document is the central index of all technical documentation for **scanldr**. It covers everything from high-level architecture to detailed flow diagrams.

## 📌 Overview
- [System Overview](overviewer.md)
- [Software Architecture (C4 Model)](architecture_c4.md)

## 🔄 Business Flows
- [Authentication Flow (Cloudflare bypass)](flows/auth_flow.md)
- [List Flow](flows/list_flow.md)
- [Download Flow](flows/download_flow.md)
- [Update Flow](flows/update_flow.md)
- [Sync Flow](flows/sync_flow.md)

## 📊 Data Models
- [Auth & Session Model](models/auth_model.md)
- [Manga & Chapter Model](models/manga_model.md)

## 📝 Architecture Decision Records (ADRs)
- [ADR-001: Cookie Replay over Playwright Stealth](adr/001-cookie-replay-strategy.md)
- [ADR-002: MangaDex as Primary Metadata and Download Source](adr/002-mangadex-primary-source.md)
- [ADR-003: SQLite for Download History](adr/003-sqlite-download-history.md)
- [ADR-004: Subscriptions Stored in SQLite, Not a Flat-Text File](adr/004-subscriptions-in-sqlite.md)

## ⚙️ CI/CD
- [Quality & Security Stack](ci-cd.md)

## 🛠 Technical Standards
- **Runtime:** Bun
- **Language:** TypeScript
- **Auth:** manual cURL paste captured from the user's real browser via DevTools
- **Metadata source:** MangaDex API
- **Output formats:** CBZ / ZIP
- **History persistence:** SQLite via `bun:sqlite`
- **Supported sources:** MangaDex (primary), mangakakalot.gg (fallback), others to be added

---
*To propose changes to this documentation, open an Issue with the label `docs`.*
