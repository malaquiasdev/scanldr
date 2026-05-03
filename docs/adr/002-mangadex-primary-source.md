# ADR-002: MangaDex as Primary Metadata and Download Source

**Date:** 2026-04-24
**Status:** Accepted

## Context

scanldr needs two things per download: **volume metadata** (which chapters belong to which volume) and **chapter images**. These can come from the same source or different ones.

The POC (`mkl`) used mangakakalot.gg for everything but that site exposes no volume metadata — only a flat chapter list. The user works in volumes (complete arcs, not weekly chapters) and does not want to manually specify chapter ranges every time.

## Decision

Use **MangaDex** as the primary source for both metadata and downloads. Fallback sites (mangakakalot.gg, etc.) are only used when:

1. The title is not available on MangaDex, **or**
2. The available languages/scanlation groups on MangaDex are not acceptable to the user.

In both cases, the CLI explicitly notifies the user and prompts for a fallback site choice. No silent fallback.

## Justification

### Why MangaDex as primary?

- **Public REST API** — well-documented, no authentication required, no Cloudflare.
- **Rich metadata** — volume→chapter mapping, multiple languages, scanlation groups, cover art.
- **Direct image downloads** — via `/at-home/server/:chapterId`, no scraping needed.
- **Reliability** — no session expiry, no cookie management for standard usage.

### Why not MangaDex-only?

MangaDex does not guarantee availability for all titles in all languages. Licensed titles may be removed. Less popular titles may have incomplete scanlations. Fallback sites cover these gaps.

### Why explicit user confirmation for fallback?

- The user cares about language quality — a silently-chosen scanlation may be in the wrong language or from an undesired group.
- Transparency builds trust — the user always knows where their files came from.

### Volume metadata reuse on fallback

When MangaDex has the volume metadata but the user prefers to download from a fallback site (e.g., better image quality), the chapter range from MangaDex is still used. The fallback site only provides images.

## Implementation Notes

- **Rate limit:** MangaDex enforces ~5 req/s. The client must throttle chapter and image requests accordingly. HTTP 429 responses include a `x-ratelimit-retry-after` or `Retry-After` header with the exact delay to wait.
- **Image quality:** `/at-home/server/:chapterId` returns two image sets — `data` (full resolution) and `data-saver` (compressed). Exposed via `download_quality` in `scanldr.json` and `--quality` CLI flag.
- **Image naming:** Pages must be saved with zero-padded sequential names (`0001.png`, `0002.png`) to guarantee correct sort order in CBZ readers.
- **Retry policy:** Up to 5 attempts per failed image. On each failure, re-fetch `/at-home/server/:chapterId` to get a fresh CDN URL before retrying — stale URLs will keep failing.
- **At-home server reporting:** MangaDex terms of use require reporting download success/failure metrics back to the API after each chapter. This includes the `x-cache` header value and download duration. Failure to report may result in reduced API access.
- **Temporary files:** Write to `.temp` first, rename to final path on success. Prevents corrupted archives on process interruption.

## Consequences

### Positive

- No Cloudflare bypass needed for the primary happy path.
- Volume-based downloads work out of the box for titles on MangaDex.
- User is always in control of language and source selection.

### Negative

- Two-source architecture adds complexity (MangaDex client + fallback clients).
- For titles not on MangaDex, the user must pass `--chapter` manually if volume metadata is also unavailable from the fallback site.
- MangaDex API rate limits apply (~5 req/s). The downloader must respect them.

## Partner-Hosted vs. CDN-Hosted Chapters

MangaDex distinguishes two categories of chapters:

- **CDN-hosted** — images served via MangaDex's own at-home CDN network. `attributes.externalUrl` is `null`. These chapters are fully downloadable through `/at-home/server/:chapterId`.
- **Partner-hosted** — images live on a publisher's platform (MangaPlus, Comikey, Cubari, etc.). `attributes.externalUrl` is set to the partner URL. The `/at-home/server/:chapterId` endpoint returns HTTP 404 for these chapters.

Most ongoing weekly Shueisha titles (One Piece, Jujutsu Kaisen, Kagurabachi, etc.) are partner-hosted via MangaPlus.

**scanldr behaviour per command:**
- `list` — annotates external chapters with `[external: <host>]` so the user knows at a glance.
- `download` — refuses early with a typed `ExternalChapterError` carrying the URL (implemented in #14/#15).
- `sync` / `update` — skips external chapters with an `info` log (implemented in #16/#17).
- `getAtHomeServer` — throws a typed `AtHomeError` with a 404-specific message hinting at external hosting, even if the caller forgets the upstream check.
