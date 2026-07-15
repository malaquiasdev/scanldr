# Architecture C4: scanldr

> Last updated 2026-07-15 — reflects post-#177 state (mangakakalot sole source; MangaDex
> retired, see [ADR-008](adr/008-retire-mangadex-source.md)). Volume mode retirement is a
> separate, later phase (Phase B) and is not reflected here.

## 1. Level 1: System Context

```mermaid
graph TD
    User[User]
    CLI[scanldr CLI<br/>bun start]
    Mangakakalot[mangakakalot.gg<br/>metadata + download]
    FS[Local Filesystem<br/>./download/]
    DB[(scanldr.db<br/>traces only)]

    User -->|runs bun start| CLI
    CLI -->|HTTP + cf_clearance| Mangakakalot
    CLI -->|writes .cbz| FS
    CLI -->|writes structured traces| DB
    FS -->|read by comic reader| User

    style CLI fill:#438dd5,color:#fff
    style Mangakakalot fill:#757575,color:#fff
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
        SourceAdapters[sources/adapters/<br/>Mangakakalot wrapper]
        MangakakalotClient[integrations/mangakakalot/<br/>HTTP + cookie replay]
        Downloader[downloader/<br/>image fetch + packaging]
        Pack[pack/<br/>CBZ/ZIP primitives]
        TraceStore[plugins/trace/<br/>structured sink — 3-day TTL]
        Logger[plugins/logger/<br/>terminal human sink + trace sink]
        AuthPath[plugins/auth-path/<br/>parseCurl — session bootstrap]
    end

    subgraph External
        FallbackSite[mangakakalot.gg]
    end

    DB[(scanldr.db<br/>traces table)]
    FS[(Local Filesystem<br/>./download/)]

    User -->|bun start| Index
    Index -->|init| TraceStore
    Index -->|init| Logger
    Index -->|runWalkthrough| Walkthrough

    Walkthrough -->|source selection + metadata| SourceAdapters
    SourceAdapters -->|calls| MangakakalotClient
    MangakakalotClient -->|HTTP + cookies| FallbackSite

    Walkthrough -->|download chapters| Downloader
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
    style MangakakalotClient fill:#438dd5,color:#fff
    style Downloader fill:#438dd5,color:#fff
    style Pack fill:#438dd5,color:#fff
    style TraceStore fill:#438dd5,color:#fff
    style Logger fill:#438dd5,color:#fff
    style AuthPath fill:#438dd5,color:#fff
    style FallbackSite fill:#757575,color:#fff
    style DB fill:#ff7043,color:#fff
    style FS fill:#4caf50,color:#fff
```

---

## 3. Key Architectural Decisions

1. **Single one-shot walkthrough** — `bun start` runs a fixed 9-step orchestrator (`src/walkthrough/`). There are no sub-commands (`download`, `list`, `sync`, `update`, etc.) — those were removed in epic #116.
2. **Mangakakalot is the sole source** — MangaDex was retired ([ADR-008](adr/008-retire-mangadex-source.md)); the source-picker step auto-selects Mangakakalot instead of prompting, since it's the only registered `SourceAdapter`.
3. **Auth uses manual cURL paste** — the user solves the Cloudflare challenge in a real browser, then copies the authenticated request via DevTools "Copy as cURL" and pastes it into the walkthrough prompt. No headless browser. Since Mangakakalot is now the sole source, every run requires this step. See `docs/auth-manual.md` and `src/plugins/auth-path/`.
4. **Trace store is the only persistent state** — the `traces` table in `scanldr.db` is the single write path for the logger's structured sink. Retention is 3 days. No download history. No subscriptions. See ADR-006.
5. **One `.cbz` per volume** — chapters within a volume are merged into a single archive via `src/pack/`, matching how the user reads (complete volumes, not weekly chapters). Volume mode retirement is tracked separately (Phase B) and is not part of ADR-008.
6. **Source adapter is a thin, replaceable seam** — `src/sources/adapters/` registers `SourceAdapter` implementations behind a factory; today only Mangakakalot is registered, but the seam supports adding sources later without touching the walkthrough orchestrator.
