# ADR-008: Retire the MangaDex source (mangakakalot sole source)

**Date:** 2026-07-15
**Status:** Accepted

**Related:**
- Supersedes [ADR-002](./002-mangadex-primary-source.md)
- Tracked by issue [#177](https://github.com/malaquiasdev/scanldr/issues/177)
- Phase 1 of a two-phase reduction; Phase B (retiring volume mode) is a separate, later issue/PR — **not** part of this ADR.

## Context

ADR-002 established MangaDex as the primary metadata/download source, with mangakakalot.gg as an explicit fallback requiring manual cURL-based cookie auth.

Product decision: MangaDex is unused in practice. A blast-radius analysis confirmed it is an isolated island in the codebase — the `mangadex` source adapter and its `src/integrations/mangadex/` client are consumed only through the `SourceAdapter` registry/factory seam, with no cross-cutting dependencies from mangakakalot or shared walkthrough/downloader/pack code. This makes it a clean excision rather than a risky untangling.

## Decision

Remove the MangaDex source entirely:

- Delete `src/integrations/mangadex/` (client, at-home, http/bucket, external-host) and `src/sources/adapters/mangadex.ts` + its test.
- Drop `"mangadex"` from `SourceId`, the `SOURCES` registry, and the adapter factory (`src/sources/adapters/index.ts`).
- Remove `download_quality` and `preferred_languages` from `Config` — these were read only by the MangaDex adapter/client (image quality selection and BCP-47 language filtering against MangaDex's API). No other code path consumes them.
- With a single registered source (`mangakakalot`), the source-picker step (`pickSource`) short-circuits and auto-selects it instead of presenting a dead 1-option prompt, while staying correct if more sources are registered later.

**mangakakalot's chapter and volume flows are untouched.** The `SourceAdapter.listVolumes` method and all volume-mode code stay — retiring volume mode is Phase B, a separate issue/PR, and is explicitly out of scope here.

## Consequences

### Positive

- Smaller surface: one source implementer instead of two, one less HTTP client/rate-limiter/retry-policy pair to maintain (~15 files deleted).
- Two dead config keys (`download_quality`, `preferred_languages`) removed along with their validation/normalization logic (BCP-47 parsing, quality enum check).
- No more dual-source branching in the adapter factory or walkthrough source step.

### Negative

- **mangakakalot was the only source that required auth; MangaDex was the only no-auth source.** With MangaDex gone, every run now requires a valid mangakakalot cURL-based session (`auth.json`) up front — there is no more no-auth fallback path. Users who previously relied on the MangaDex happy path must now complete the cURL paste flow every time their session goes stale.
- Losing MangaDex's rich metadata (multi-language, scanlation-group selection, direct CDN downloads) — mangakakalot's scrape-based client is the only remaining implementation, with the DOM-drift fragility that implies (see #114).
- Titles not available on mangakakalot (or blocked by Cloudflare beyond the existing retry/refresh flow) now have no fallback source at all.

### Neutral

- The `Config` interface no longer carries any MangaDex-only knobs — the remaining keys (`default_format`, `default_out`, `db_path`, `image_concurrency`, `chapter_delay_ms`) are all consumed by the shared downloader/packer/walkthrough layers.
- Volume mode retirement (Phase B) is intentionally deferred to keep this change reviewable and revertible independent of the (larger, riskier) volume-mode removal.

## Alternatives Considered

- **Keep MangaDex behind a feature flag instead of deleting it** — rejected. Product decision is that MangaDex is unused; keeping dead code behind a flag still carries the maintenance cost (rate-limit handling, at-home reporting, mocks) for no benefit.
- **Retire volume mode in the same change** — rejected. Volume mode is mangakakalot-native and independent of the MangaDex removal; bundling both increases blast radius and review risk for no interdependency. Tracked separately as Phase B.
- **Keep `download_quality`/`preferred_languages` as inert config for forward-compatibility** — rejected. Dead, unvalidated-against-anything config is worse than no config; if a future source needs language/quality selection, it should define its own contract.
