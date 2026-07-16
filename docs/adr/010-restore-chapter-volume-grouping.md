# ADR-010: Restore chapter→volume grouping (pack + cover), keep download-by-volume retired

**Date:** 2026-07-16
**Status:** Accepted

**Related:**
- Amends [ADR-009](./009-retire-volume-mode.md) (Phase B of the reduction, merged in #180)
- Corrects an over-removal in #180
- Tracked by issue [#183](https://github.com/malaquiasdev/scanldr/issues/183)

## Context

ADR-009 conflated two distinct features under "volume mode" and retired both:

1. **Download BY volume** — fetching the source's volume→chapter mapping and picking a
   volume as the download unit (`mode-picker`, `listVolumes`, `getVolumeMap`,
   `volume-parser`, the range-picker volume branch, the volume-expansion in `execute.ts`).
2. **Group selected chapters INTO a volume `.cbz`** — the user picks chapters themselves
   (as chapter mode always worked), then optionally bundles the downloaded chapters into
   one volume `.cbz` with a name + optional cover (`src/pack/*`, `pack-prompt`,
   `volume-name-prompt`, `cover-prompt`, the pack/cover blocks in `execute.ts`).

Only (1) was an unused, source-coupled feature (HTML-scraped volume→chapter mapping).
(2) is a post-selection convenience on top of the chapter flow that has nothing to do with
how chapters are discovered or picked — it operates purely on the already-downloaded
chapter files. Removing it was a mistake: users who select a chapter range still want the
option of a single packed `.cbz` instead of one file per chapter.

## Decision

Restore chapter→volume grouping. Download-by-volume stays retired.

Target flow: search → chapter range picker → **"group these chapters into a single volume
`.cbz`?"**
- **No** → one `.cbz` per chapter (unchanged since ADR-009).
- **Yes** → volume name prompt (optional, defaults to a chapter-range-derived name) →
  optional cover-URL prompt → download the selected chapters + pack them into one volume
  `.cbz` + inject the cover. On success, the loose per-chapter `.cbz` files that were just
  packed are deleted, leaving only the single volume `.cbz` on disk (deletion is best-effort:
  a failure to remove one file is warn-logged and does not fail the run or drop the volume).

There is still no mode picker: grouping is a single post-selection prompt in the normal
chapter-picking flow, not an alternative to it.

Concretely:

- Restored verbatim from pre-#180 history (`src/pack/*`, `pack-prompt`,
  `volume-name-prompt`, `cover-prompt`, and their tests) — these files only ever depended
  on the already-selected chapter list, never on volume-mapping.
- `src/walkthrough/types.ts`: re-added `Packer`, `PackVolumeInput` import, and
  `WalkthroughResult.{groupIntoVolume, volumeName, coverUrl}`. Did **not** re-add
  `ModeSelection`, `VolumeListing`, or `BundleItem.{chapterIds, chapterNums}` — those exist
  only to support download-by-volume expansion, which stays gone.
- `src/walkthrough/steps/execute.ts`: re-added the pack/cover-injection step, invoked
  after the existing per-chapter download loop, operating on the chapter outputs already
  produced by that loop. Did **not** re-add the `bundle.kind === "volume"` source-volume
  expansion branch. After a successful pack, `deleteIndividualFiles` (`src/pack/pack.ts`)
  is invoked to remove the per-chapter `.cbz` files that were just packed; this only runs
  once the volume `.cbz` write has succeeded (never before), and a per-file deletion
  failure is warn-logged and skipped rather than failing the run.
- `src/walkthrough/index.ts`: after the chapter range picker, calls `promptPack`; when
  the answer is yes, calls `promptVolumeName` + `promptCoverUrl` and threads
  `groupIntoVolume`/`volumeName`/`coverUrl` into `executeWalkthrough`.
- `src/downloader/types.ts`'s `BundleKind` stays `"chapter"` only — the pack step
  operates on the downloader's chapter-mode output files and has its own volume-filename
  builder (`buildVolumeFilename`) in `src/pack/pack.ts`; it never needs the downloader to
  understand a `"volume"` bundle kind.

## Justification

- **The two features are orthogonal.** Download-by-volume is about *discovery/selection*
  (turning a source's volume metadata into a pickable unit). Chapter→volume grouping is
  about *post-processing* (packaging already-selected, already-downloaded chapters). ADR-009
  correctly retired the first (unused, source-coupled, real maintenance cost) but had no
  justification for retiring the second — it is pure output-shaping on data the chapter flow
  already produces.
- **Restoring verbatim was safe.** `src/pack/*` and its prompts only import from
  `downloader/helpers.ts` (`isNoneToken`, `padBundleNumber`) and `plugins/*`, none of which
  changed shape since the pre-#180 snapshot. No adaptation was needed beyond re-wiring the
  DTOs and the execute/index call sites.
- **No mode picker reintroduced.** Grouping is decided after chapters are already picked,
  so it does not resurrect the discovery-time chapter/volume choice ADR-009 removed.

## Consequences

### Positive

- Users can again produce a single volume `.cbz` (with optional cover) from a chapter
  range, without scanldr regaining any volume-discovery/source-mapping surface.
- `src/pack/*` is self-contained and has no dependency on volume-mapping — restoring it
  does not reintroduce any of the maintenance burden ADR-009 removed.

### Negative

- `execute.ts` and `walkthrough/index.ts` regain one more branch (pack/cover) and one more
  prompt sequence (pack → name → cover) — some test combinatorics return (grouping ×
  cover), though scoped to a single post-loop step rather than a whole alternate mode.

### Neutral

- `getChapterList`/`FallbackChapterRef`, `reassembleChapterPages` (#168), and the chapter
  range-picker are untouched by this change — they never depended on pack/cover.
- `downloader/types.ts`'s `BundleKind` remains `"chapter"` only; the downloader itself has
  no notion of volumes, before or after this ADR.

## Alternatives Considered

- **Re-add download-by-volume too** — rejected. ADR-009's rationale for retiring
  discovery-by-volume (unused, source-coupled, real maintenance cost keeping
  `mode-picker`/`volume-parser`/`getVolumeMap` in sync with the shared layer) still holds
  and is unaffected by this ADR.
- **Implement grouping as an external post-processing tool instead of restoring
  `src/pack/*`** — rejected. The pre-#180 implementation already existed, was tested, and
  is source-agnostic (operates on `.cbz` files on disk); re-implementing it externally would
  duplicate working code for no benefit.
