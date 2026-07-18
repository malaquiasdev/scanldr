# MAL-Powered LOCG Recommendations Feasibility — Discovery Report

**Date:** 2026-07-18
**Issue:** none yet — pure discovery, no code committed
**Status:** Discovery — no code committed
**Recommendation:** **Rejected as specified (route A).** Domain mismatch is fatal. If pursued, only the manga subset via AniList (route B); Western comics need Comic Vine (route C). Not aligned with scanldr's current scope (downloader, not recommender).

## Executive summary

The question analyzed: can scanldr use MyAnimeList (MAL) to suggest reading recommendations based on the user's League of Comic Geeks (LOCG) collection (e.g. `https://leagueofcomicgeeks.com/profile/malaquiasdev/collection`)? Desired flow: LOCG collection → match to a catalog → recommendation engine → suggest titles → (optionally download via scanldr). Three hard problems surface, in severity order: MAL is manga/anime-only and cannot ingest an arbitrary Western-comics collection (fatal domain mismatch); LOCG's collection page and API are not accessible without an authenticated/approved session; and scanldr today has no library/collection persistence or metadata shape to anchor cross-catalog matching, and no OAuth pattern. Net: reject as specified; at most a narrow manga-only spike via AniList, contingent on scanldr re-adding library state.

## Q1 — Domain mismatch (fatal)

LOCG is a Western-comics catalog (Marvel/DC/Image/indie, plus some manga). MAL is manga/anime ONLY — there is no MAL concept of a Western single-issue comic, a run, or a publisher imprint. MAL's recommendation surface (`/manga/{id}/userrecs`-style, and the API v2 equivalent) is per-title *within MAL's own catalog* — it takes a MAL manga id and returns other MAL manga ids "users who liked X also liked." It cannot ingest an arbitrary external collection list, and it has no matching concept for non-manga content. Only the manga subset of an LOCG collection maps to MAL's catalog at all; every Western comic in the collection is unrepresentable. For a LOCG collection that is comics-heavy (the common case), this defeats the premise before any implementation question is reached.

## Q2 — LOCG access

The public profile/collection page (`leagueofcomicgeeks.com/profile/<user>/collection`) returns HTTP 403 to an anonymous fetch — it requires an authenticated session and sits behind anti-bot/Cloudflare protection. LOCG does expose an API, but it is partner/approved-only; it is not open to general developers, so there is no sanctioned programmatic path to read a collection. The remaining option is authenticated scraping using the user's own logged-in session plus a Cloudflare bypass — the same class of problem scanldr already fights with mangakakalot (see `docs/decisions/` ADR-002 lineage), but strictly worse: it requires capturing and maintaining the *user's* authenticated session/cookies, not an anonymous one.

## Q3 — Scope / architecture mismatch

scanldr today is a download-centric tool, not a metadata or recommendation engine. Confirmed by reading the current codebase:

- `src/sources/adapters/types.ts` — the `SourceAdapter` contract is `search → listChapters → fetchChapterInput`, terminating in a `ChapterInput` (image refs + a byte fetcher) for the downloader service. This shape has no place to hang a recommendation, a genre, or a cross-catalog id.
- `src/integrations/_shared/manga.ts` — the shared domain model (`MangaCandidate`) carries only `id`, `title`, `originalLanguage`, `year`. No genres, authors, synopsis, or external-catalog id — nothing to anchor cross-catalog matching or a recommendation score.
- `migrations/004_drop_subscriptions_and_downloads.sql` — the DB was deliberately reduced to a single `traces` table; this migration dropped all per-manga/library/list state. No library/collection persistence exists today. A recommender needs net-new tables (a collection, per-item catalog ids, recommendation cache) — this is a reversal of a recent, deliberate architectural decision, not a small addition.
- `src/plugins/auth-path/` and `src/integrations/mangakakalot/auth/` — the only auth/session pattern in the codebase is a secure single-file JSON cookie store, scoped to mangakakalot's cookie-session model. There is no OAuth/bearer-token pattern anywhere in the codebase (grep confirms zero matches). MAL API v2 uses OAuth2 with PKCE; AniList uses OAuth2 for user-scoped calls. Either would be a net-new auth subsystem, not a reuse of the existing pattern.

## Q4 — Cross-catalog matching problem

Even restricted to the manga subset of an LOCG collection, recommending a *download* requires a 3-catalog id-reconciliation chain: LOCG id → MAL/AniList id → scanldr download-source id (mangakakalot/allmanga/etc.). Each hop is fuzzy title-matching (no shared canonical id across any of the three), and errors compound multiplicatively across the chain — a mismatch at any hop silently produces a wrong recommendation or a wrong download target.

## Q5 — Comparison of catalog/recommendation options

| Dimension | MAL API v2 | AniList GraphQL API | Comic Vine API | LOCG API |
|---|---|---|---|---|
| Domain coverage | Manga/anime only | Manga/anime only | Western comics (rich metadata) | Western comics (the source collection) |
| Access model | OAuth2 PKCE; free client id for public reads | Open, no partner gate; OAuth2 for user data | Open, free API key | Partner/approved-only |
| Recommendation feature | Per-title `userrecs` (MAL-internal catalog only) | `Recommendations` type in schema (MAL-internal catalog only) | None — metadata catalog, no "users who liked X" | Unknown/not applicable (no public docs) |
| Fit for a LOCG-collection-driven recommender | No — domain mismatch, and cannot ingest external collection | Better DX/access than MAL, but same domain mismatch | No native recommender — would require building one ourselves | Not viable without partner approval |

## Q6 — Recommendation & routes

- **Route A (recommended): reject as specified.** Do not build this into scanldr now. It is a different product shape (recommender vs. downloader), and the domain mismatch (Q1) defeats the LOCG premise regardless of implementation effort. Record this discovery and defer.
  - Risk if ignored: **P0** — building against a fatal domain mismatch produces a feature that silently fails for most of a typical LOCG (comics-heavy) collection.
- **Route B (if manga-only recommendations are ever wanted, independent of LOCG):** use AniList (not MAL — better access, same domain limit) against a manga library the user already keeps *in scanldr*. Blocked today: scanldr has no library/collection state (Q3) — this is gated on re-adding persistence, which means revisiting the `004_drop_subscriptions_and_downloads.sql` decision and the related ADRs before any recommendation code is written.
  - Risk: **P1** — reopening dropped persistence is an architectural reversal, not a quick add.
- **Route C (if the Western-comics collection is the real goal):** no manga catalog fits. Would require Comic Vine for metadata plus a self-built recommendation engine (no vendor "users who liked X" exists for comics) plus a solved LOCG access problem (Q2). Large scope, out of scanldr's current boundaries.
  - Risk: **P1** — self-built recommender is a new product surface, not a scanldr feature.
- Other risks noted for completeness:
  - **P2** — cross-catalog id reconciliation (Q4) is fragile and error-compounding even within route B's narrower scope.
  - **P2** — LOCG authenticated scraping (Q2) carries the same brittleness class as existing mangakakalot handling, worsened by requiring the user's own session.
  - **P3** — MAL/AniList OAuth token lifecycle (refresh, revocation) is unimplemented anywhere in scanldr today; net-new maintenance surface if ever pursued.
- **ADR:** not warranted at this stage — no code is proposed. If route B is ever picked up, it should follow a persistence-reversal ADR before implementation.
- **Next step:** none planned. This document exists to close the question and prevent re-litigating it without new information (e.g. LOCG opening a public API, or scanldr re-adding library persistence for an unrelated reason).

## References

- Source adapter interface: [`src/sources/adapters/types.ts`](../../src/sources/adapters/types.ts)
- Shared manga domain model: [`src/integrations/_shared/manga.ts`](../../src/integrations/_shared/manga.ts)
- Dropped persistence migration: [`migrations/004_drop_subscriptions_and_downloads.sql`](../../migrations/004_drop_subscriptions_and_downloads.sql)
- Existing auth/session pattern (cookie-store, not OAuth): [`src/plugins/auth-path/`](../../src/plugins/auth-path/), [`src/integrations/mangakakalot/auth/`](../../src/integrations/mangakakalot/auth/)
