# Architecture C4: scanldr

> Last updated 2026-05-10 — reflects post-epic #116 state (walkthrough CLI, trace-as-state, no history/subscriptions).

## 1. Level 1: System Context

```mermaid
graph TD
    User[User]
    CLI[scanldr CLI<br/>bun start]
    MangaDex[MangaDex API<br/>metadata + download]
    Fallback[Fallback Sites<br/>e.g. mangakakalot.gg]
    FS[Local Filesystem<br/>./download/]
    DB[(scanldr.db<br/>traces only)]

    User -->|runs bun start| CLI
    CLI -->|REST API — metadata + images| MangaDex
    CLI -->|HTTP + cf_clearance — fallback images| Fallback
    CLI -->|writes .cbz| FS
    CLI -->|writes structured traces| DB
    FS -->|read by comic reader| User

    style CLI fill:#438dd5,color:#fff
    style MangaDex fill:#ff6740,color:#fff
    style Fallback fill:#757575,color:#fff
    style User fill:#08427b,color:#fff
    style FS fill:#4caf50,color:#fff
    style DB fill:#ff7043,color:#fff
```

---

## 2. Level 2: Containers

```mermaid
graph TD
    User[User]

    subgraph scanldr [scanldr CLI]
        Index[index.ts<br/>boot: trace store + logger init]
        Walkthrough[walkthrough/<br/>9-step orchestrator]
        SourceAdapters[sources/adapters/<br/>MangaDex + Mangakakalot wrappers]
        MangaDexClient[integrations/mangadex/<br/>MangaDex API client]
        MangakakalotClient[integrations/mangakakalot/<br/>HTTP + cookie replay]
        Downloader[downloader/<br/>image fetch + packaging]
        Pack[pack/<br/>CBZ/ZIP primitives]
        TraceStore[plugins/trace/<br/>structured sink — 3-day TTL]
        Logger[plugins/logger/<br/>terminal human sink + trace sink]
        AuthPath[plugins/auth-path/<br/>parseCurl — session bootstrap]
    end

    subgraph External
        MangaDex[MangaDex API]
        FallbackSite[mangakakalot.gg]
    end

    DB[(scanldr.db<br/>traces table)]
    FS[(Local Filesystem<br/>./download/)]

    User -->|bun start| Index
    Index -->|init| TraceStore
    Index -->|init| Logger
    Index -->|runWalkthrough| Walkthrough

    Walkthrough -->|source selection + metadata| SourceAdapters
    SourceAdapters -->|calls| MangaDexClient
    SourceAdapters -->|calls| MangakakalotClient
    MangaDexClient -->|REST| MangaDex
    MangakakalotClient -->|HTTP + cookies| FallbackSite

    Walkthrough -->|download chapters| Downloader
    Downloader -->|images| MangaDex
    Downloader -->|images| FallbackSite
    Downloader -->|pack primitives| Pack
    Pack -->|.cbz| FS

    Walkthrough -->|auth bootstrap| AuthPath
    Logger -->|structured rows| TraceStore
    TraceStore -->|read/write| DB

    style scanldr fill:#e1f5fe,stroke:#01579b,stroke-dasharray: 5 5
    style External fill:#f9f9f9,stroke:#333,stroke-dasharray: 5 5
    style Index fill:#438dd5,color:#fff
    style Walkthrough fill:#438dd5,color:#fff
    style SourceAdapters fill:#438dd5,color:#fff
    style MangaDexClient fill:#438dd5,color:#fff
    style MangakakalotClient fill:#438dd5,color:#fff
    style Downloader fill:#438dd5,color:#fff
    style Pack fill:#438dd5,color:#fff
    style TraceStore fill:#438dd5,color:#fff
    style Logger fill:#438dd5,color:#fff
    style AuthPath fill:#438dd5,color:#fff
    style MangaDex fill:#ff6740,color:#fff
    style FallbackSite fill:#757575,color:#fff
    style DB fill:#ff7043,color:#fff
    style FS fill:#4caf50,color:#fff
```

---

## 3. Key Architectural Decisions

1. **Single one-shot walkthrough** — `bun start` runs a fixed 9-step orchestrator (`src/walkthrough/`). There are no sub-commands (`download`, `list`, `sync`, `update`, etc.) — those were removed in epic #116.
2. **MangaDex is the primary source** — metadata (volume→chapter mapping) and downloads come from MangaDex first. Fallback sites are only used when the user explicitly chooses them.
3. **User controls language and source** — the CLI never silently picks a language or falls back to another site. It always presents options and waits for confirmation.
4. **Auth uses manual cURL paste** — the user solves the Cloudflare challenge in a real browser, then copies the authenticated request via DevTools "Copy as cURL" and pastes it into the walkthrough prompt. No headless browser. See `docs/auth-manual.md` and `src/plugins/auth-path/`.
5. **Trace store is the only persistent state** — the `traces` table in `scanldr.db` is the single write path for the logger's structured sink. Retention is 3 days. No download history. No subscriptions. See ADR-006.
6. **One `.cbz` per volume** — chapters within a volume are merged into a single archive via `src/pack/`, matching how the user reads (complete volumes, not weekly chapters).
7. **Parser is site-specific** — each source has its own integration client under `src/integrations/`, surfaced through source adapters in `src/sources/`.
