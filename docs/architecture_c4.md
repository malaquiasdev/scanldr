# Architecture C4: scanldr

> Last updated 2026-07-17 — reflects post-#210 state (v1.2.0): mangakakalot sole source;
> MangaDex retired, see [ADR-008](adr/008-retire-mangadex-source.md); chapter→volume grouping
> restored (optional), see [ADR-010](adr/010-restore-chapter-volume-grouping.md); auth is
> patchright undetected-browser capture (primary) with manual cURL paste (fallback), see
> [ADR-002](adr/002-manual-cookie-paste.md).

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
        Walkthrough[walkthrough/<br/>6-step orchestrator]
        SourceAdapters[sources/adapters/<br/>Mangakakalot wrapper]
        MangakakalotClient[integrations/mangakakalot/<br/>HTTP + cookie replay]
        Downloader[downloader/<br/>image fetch + per-chapter .cbz]
        TraceStore[plugins/trace/<br/>structured sink — 3-day TTL]
        Logger[plugins/logger/<br/>terminal human sink + trace sink]
        AuthPath[plugins/auth-path/<br/>XDG auth.json path resolver]
        BrowserCapture[integrations/mangakakalot/auth/browser-capture/<br/>patchright capture — primary]
        CurlParser[integrations/mangakakalot/auth/<br/>curl-parser.ts — fallback]
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
    Downloader -->|.cbz| FS

    Walkthrough -->|resolve auth.json path| AuthPath
    Walkthrough -->|primary: capture fresh session| BrowserCapture
    BrowserCapture -->|headed Chrome, human solves CF| FallbackSite
    Walkthrough -->|fallback: parse pasted cURL| CurlParser
    Logger -->|structured rows| TraceStore
    TraceStore -->|read/write| DB

    style scanldr fill:#e1f5fe,stroke:#01579b,stroke-dasharray: 5 5
    style External fill:#f9f9f9,stroke:#333,stroke-dasharray: 5 5
    style Index fill:#438dd5,color:#fff
    style Walkthrough fill:#438dd5,color:#fff
    style SourceAdapters fill:#438dd5,color:#fff
    style MangakakalotClient fill:#438dd5,color:#fff
    style Downloader fill:#438dd5,color:#fff
    style TraceStore fill:#438dd5,color:#fff
    style Logger fill:#438dd5,color:#fff
    style AuthPath fill:#438dd5,color:#fff
    style BrowserCapture fill:#438dd5,color:#fff
    style CurlParser fill:#438dd5,color:#fff
    style FallbackSite fill:#757575,color:#fff
    style DB fill:#ff7043,color:#fff
    style FS fill:#4caf50,color:#fff
```

---

## 3. Key Architectural Decisions

1. **Single one-shot walkthrough** — `bun start` runs a fixed 6-step orchestrator (`src/walkthrough/`). There are no sub-commands (`download`, `list`, `sync`, `update`, etc.) — those were removed in epic #116.
2. **Mangakakalot is the sole source** — MangaDex was retired ([ADR-008](adr/008-retire-mangadex-source.md)); the source-picker step auto-selects Mangakakalot instead of prompting, since it's the only registered `SourceAdapter`.
3. **Auth uses patchright undetected-browser capture (primary), manual cURL paste (fallback)** — on a stale/absent session, the walkthrough launches the user's real Chrome via `patchright` (a Playwright fork with automation-detection leaks patched), the user solves the Cloudflare challenge in the visible window, and scanldr harvests the fresh `cf_clearance` + user-agent directly from the live browser context — no DevTools copying needed. On no-Chrome, cancel, capture error, or probe failure, it falls back to the manual cURL-paste flow. Since Mangakakalot is now the sole source, every run requires this step. See `docs/auth-manual.md`, `src/integrations/mangakakalot/auth/browser-capture/` (capture) + `curl-parser.ts` (fallback), and `src/plugins/auth-path/` (XDG path resolution only).
4. **Trace store is the only persistent state** — the `traces` table in `scanldr.db` is the single write path for the logger's structured sink. Retention is 3 days. No download history. No subscriptions. See ADR-006.
5. **One `.cbz` per chapter by default, with optional volume grouping** — chapter-only download mode was made the base ([ADR-009](adr/009-retire-volume-mode.md)), and chapter→volume grouping (pack + cover) was subsequently restored as an opt-in step ([ADR-010](adr/010-restore-chapter-volume-grouping.md)); every chapter is still downloaded individually, and grouping into a single volume `.cbz` is optional.
6. **Source adapter is a thin, replaceable seam** — `src/sources/adapters/` registers `SourceAdapter` implementations behind a factory; today only Mangakakalot is registered, but the seam supports adding sources later without touching the walkthrough orchestrator.
