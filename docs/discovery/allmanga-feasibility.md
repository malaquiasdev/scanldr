# allmanga.to Feasibility — Discovery Report

**Date:** 2026-07-02
**Issue:** [#161](https://github.com/malaquiasdev/scanldr/issues/161)
**Status:** Discovery complete + live spike done — no code committed
**Recommendation:** **GO for a download-only MVP (route B); native search/detail deferred (route A).** Design tracked in [#161](https://github.com/malaquiasdev/scanldr/issues/161).

## Executive summary

allmanga.to (allanime/allmanga family) is a client-rendered SPA backed by a GraphQL API at `https://api.allanime.day/api`. No HTML scraping. The chapter-download path is stable and anonymous; the search/detail path is Cloudflare-gated with rotating persisted-query hashes and is **not** solvable by the mangakakalot-style cookie paste (see Q5 spike). Net: cleaner than mangakakalot on download, harder on metadata.

## Q1 — Data access shape

Client-rendered SPA; all data via GraphQL `https://api.allanime.day/api`. Page routes (`allmanga.to/manga/<id>`) return a Cloudflare challenge shell (`cf-mitigated: challenge`, "Just a moment...", Turnstile). Chapters are modeled as "episodes" (`episodeInfos`, `episodeIdNum`). The live backend is `api.allanime.day` only (`api.allanime.co` / `apivtwo.allanime.co` are parked/decoy hosts).

## Q2 — Auth / anti-bot

No login/account. Cloudflare fronts everything: interactive challenge on page routes, the bare `/api` path, and raw GraphQL `query=` requests; a separate WAF/rate-limit block ("Attention Required!") trips on aggressive probing. Persisted-query hashes are WAF-whitelisted (only reason anonymous cURL reaches data). Required headers: browser `User-Agent` + `Referer: https://allmanga.to/`.

## Q3 — Image delivery (verified end-to-end)

1. `chapterPages` persisted query (hash `466783e19a7540387e34265be906bebbe853857088d45d28af922ab8668ebb31`) → `{ tobeparsed: <base64> }`.
2. Decrypt with Bun native `crypto.subtle` (zero deps): `msg = base64decode(tobeparsed)`; `iv = msg[1:13]`; `tag = msg[-16:]`; `ciphertext = msg[13:-16]`; `key = SHA-256("Xot36i3lK3:v1")`; AES-GCM decrypt → JSON `chapterPages.edges[0].{ pictureUrlHead, pictureUrls[] }`.
3. Final image URL = `new URL(pictureUrls[i].url, pictureUrlHead)`. Sample: ch.1 = 61 pages, `pictureUrlHead = https://aln.youtube-anime.com/`.
4. Images are referer-locked (hotlink protection, mangakakalot-style): fetch with `Referer: https://allmanga.to/` → `200 image/*`. Maps to the existing `getAnonymous` lane. No per-image scramble (the `clock`/`clock.json` indirection is for anime video, not manga).

## Q4 — ID / DTO model

Manga id = opaque token (e.g. `QrSyGS2qTuZYFds8c`), the whole `/manga/<id>` slug. Chapter = `episodeIdNum` → `chapterString`. `translationType` = sub|dub|raw (default sub). Composite chapter id needed (mangaId + chapterString + type). No volume metadata → `listVolumes()` throws `WalkthroughError` (chapter-mode only, like mangakakalot).

## Q5 — Live spike (2026-07-02) — the decisive test

Ran real curl probes:

- Anonymous `chapterPages` persisted query → **WORKS**, stable, returned `tobeparsed`.
- Raw `mangas` / `manga` / `episodeInfos` GraphQL → Cloudflare challenge.
- Raw query WITH a pasted `cf_clearance` cookie → **STILL challenged**. Root cause: `cf_clearance` is domain-bound — captured on `allmanga.to`, but the API is `api.allanime.day` (different registrable domain), so cookie-replay does not transfer. This **disproves** the initial "cookie paste like mangakakalot solves it" assumption (mangakakalot works because site + content share a domain).
- Persisted hashes for search/detail rotate/expire within a session (observed) — not hardcodable.

## Q6 — Comparison to mangakakalot

| Dimension | mangakakalot | allmanga.to |
|---|---|---|
| Data format | HTML (DOM drift risk) | JSON (GraphQL, stable schema) |
| Download auth | cookie replay (ADR-002) | anonymous, persisted-hash whitelisted |
| Image obfuscation | none | one AES-GCM envelope, native `crypto.subtle` |
| Volumes | derived from HTML | none |
| Search/detail gate | `cf_clearance` unblocks it | CF + rotating persisted hashes — harder |
| Content | manga | adds manhua/manhwa — genuine catalog complement |

Download path is cleaner on allmanga; the metadata path is riskier.

## Q7 — Recommendation & routes

- **Route B (MVP, recommended):** download-only. Input = pasted manga URL/id (no search). Enumerate chapters by probing `chapterPages` incrementally until N consecutive misses. Uses only the stable, verified path. Low risk. Tracked in [#161](https://github.com/malaquiasdev/scanldr/issues/161).
- **Route A (follow-up):** native search/detail via dynamic persisted-hash discovery (scrape the SPA JS bundle for current hashes). Fragile (rotation); deferred.
- **Risks:**
  - P1 — hash/decrypt-key rotation (versioned `:v1`, isolate + warn on decrypt failure).
  - P2 — WAF rate-limit on aggressive probing (throttle chapter-enumeration).
  - P2 — chapter-enumeration gaps (`.5` / bonus chapters missed without a detail query).
  - P1 — ToS (unlicensed aggregator, same posture as mangakakalot — no new stance).
- **ADR:** not warranted; at most an ADR-002 addendum ("metadata gated on a separate domain → download-only via stable persisted hash").
- **Next step:** implement route B per [#161](https://github.com/malaquiasdev/scanldr/issues/161).

## References

- Source adapter interface: [`src/sources/adapters/types.ts`](../../src/sources/adapters/types.ts)
- Closest analog: [`src/sources/adapters/mangakakalot.ts`](../../src/sources/adapters/mangakakalot.ts)
- Shared HTTP client: [`src/integrations/fallback-http/`](../../src/integrations/fallback-http/)
- Design issue: [#161](https://github.com/malaquiasdev/scanldr/issues/161)
