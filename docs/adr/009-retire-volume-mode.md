# ADR-009: Retire volume download mode (chapter-only)

**Date:** 2026-07-15
**Status:** Accepted

**Related:**
- Supersedes the volume-justification half of [ADR-002](./002-mangadex-primary-source.md)
- Phase B of the two-phase reduction; Phase A (retiring MangaDex, [ADR-008](./008-retire-mangadex-source.md)) merged in #178.
- Tracked by issue [#179](https://github.com/malaquiasdev/scanldr/issues/179)

## Context

ADR-002 justified MangaDex as the primary source in large part because the user works in
volumes (complete arcs) and did not want to specify chapter ranges manually — MangaDex's
volume→chapter aggregate made that possible. ADR-008 retired MangaDex, but mangakakalot's
volume-mode support (HTML-scraped volume→chapter mapping, plus the pack + cover-injection
step needed to produce one `.cbz` per volume) stayed in place as a working, mangakakalot-native
feature.

Product decision: volume mode is unused in practice. The remaining feature surface — mode
picker, pack prompt, volume-name prompt, cover-url prompt, `src/pack/` (CBZ packing +
cover injection), and mangakakalot's `getVolumeMap`/volume-parser — exists only to serve a
workflow nobody exercises.

## Decision

Retire volume download mode entirely. Every download is now a single chapter downloaded as
its own `.cbz`. Specifically:

- Delete `src/pack/` (CBZ/ZIP packaging + cover-injection primitives) — it was consumed only
  by the volume-mode execute path.
- Delete the walkthrough steps `mode-picker`, `pack-prompt`, `volume-name-prompt`,
  `cover-prompt` — no chapter/volume choice remains, so there is nothing left to prompt for.
- Delete mangakakalot's `volume-parser.ts` (HTML volume→chapter scraping) and the
  `getVolumeMap`/`VolumeBucket`/`VolumeMap` surface from the client, client types, and the
  `SourceAdapter` interface. `getChapterList` and `FallbackChapterRef` are untouched — chapter
  mode depends on both.
- Collapse `execute.ts` and `walkthrough/index.ts`'s `runDownloadFlow` to a single
  chapter-per-bundle path: no volume expansion, no `groupIntoVolume`/pack step, no cover
  fetch/injection.
- `downloader/types.ts`'s `BundleKind` narrows from `"volume" | "chapter"` to `"chapter"`
  only. The downloader's filename template (`${slug}-${kind}-${padded}.cbz`) is unchanged —
  it still emits `${slug}-chapter-${n}.cbz`.

## Justification

- **Unused feature, real maintenance cost.** Pack/cover/volume-mapping code has to be kept in
  sync with the chapter-mode path (shared `execute.ts`, shared walkthrough types) for a
  workflow that isn't exercised. Every change to the shared execute/range-picker/walkthrough
  layer had to reason about both modes.
- **mangakakalot's volume support was a real, working feature** (HTML scraping of `Vol.X
  Ch.Y` groupings, with an API-placeholder fallback path for sites like naruto that moved to
  client-side chapter lists) — this is not a "retire broken code" decision, it's a scope cut.
  Removing it trades that capability for a smaller, simpler surface.
- **Chapter mode is a strict subset, not a degraded fallback.** Chapter mode already worked
  standalone (mangakakalot never guaranteed volume metadata for every title); it's promoted
  to the only mode rather than papering over a broken one.

## Consequences

### Positive

- Smaller surface: no pack primitives, no cover-fetch/injection, no volume↔chapter mapping
  parser, no mode/pack/cover prompts in the walkthrough.
- `execute.ts` and `runDownloadFlow` collapse to a single code path — no more
  `bundle.kind === "volume"` branch, no `shouldPack` conditional, no cover-injection block.
- One fewer independent axis of test combinatorics (mode × pack × cover) in `execute.test.ts`,
  `walkthrough.test.ts`, and `range-picker.test.ts`.

### Negative

- Users who want a single `.cbz` per volume must now do so with an external tool (e.g. `zip`
  merge of the per-chapter `.cbz` files) — scanldr no longer does this for them.
- Cover-art injection is gone; downloaded archives never carry a cover image.
- mangakakalot's volume-page scraping (naruto's API-placeholder route included) is deleted
  code; reinstating volume mode later requires re-implementing (or restoring from git
  history) `volume-parser.ts` and the pack/cover primitives.

### Neutral

- `getChapterList`/`FallbackChapterRef` and `reassembleChapterPages` (CDN-tile reassembly,
  #168) are untouched — they're chapter-mode primitives with no volume-mode dependency.
- The downloader's chapter filename template (`${slug}-chapter-${n}.cbz`) was already
  chapter-shaped; only the `BundleKind` type narrowed, not the runtime naming.

## Alternatives Considered

- **Keep volume mode behind a flag** — rejected. Same rationale as ADR-008: an unused,
  unexercised code path behind a flag still carries full maintenance cost (keeping the pack/
  cover/volume-mapping surface in sync with every shared-layer change) for no benefit.
- **Keep pack/cover but drop only the HTML volume-mapping scrape** — rejected. Without volume
  grouping there is no more than one chapter per pack invocation in practice, making the pack
  step a no-op wrapper around a single-file archive; deleting it outright is simpler than
  keeping a effectively-dead abstraction.
