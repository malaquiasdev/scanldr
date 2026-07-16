# mangakakalot.gg Tiled Pages — Discovery Report

**Date:** 2026-07-14
**Issue:** [#168](https://github.com/malaquiasdev/scanldr/issues/168)
**Status:** Discovery complete — no code committed
**Recommendation:** Fix via vertical stitch, tracked in [#168](https://github.com/malaquiasdev/scanldr/issues/168); decision recorded in [ADR-007](../adr/007-reassemble-cdn-tiled-pages.md).

## Executive summary

mangakakalot.gg pages render "cut in two" — the bottom half of a page appears as if it were the next page. Reported by a user on *Zombie 100* (volume 8). Root cause confirmed: the mangakakalot CDN pre-slices tall page images into fixed-width vertical tiles before serving them, and our parser maps one `<img>` element to one output page, so each tile is packed as its own standalone page. This is not a bug in scanldr's byte handling — it is a mismatch between the source's tiling and our one-image-per-page assumption.

## Hypotheses investigated

### H1 — Source splits a tall image and we treat each half as a page. **CONFIRMED.**

The CDN serves the same logical page as two (or more) sequential `<img>` tags, each a vertical slice of the original artwork. Our parser has no notion of "this image is part of a group" — every `<img>` becomes a distinct page entry.

### H2 — We force a fixed page size (A4) and crop. **DISPROVEN.**

scanldr does zero image processing. Bytes flow verbatim from CDN response to `Uint8Array` to zip entry:

- [`src/downloader/service.ts:117`](../../src/downloader/service.ts) — CDN response body is read straight into a `Uint8Array`, no resize/crop/transform.
- `src/pack/pack.ts` — bytes were written into the zip entry as-is (`src/pack/` removed by [ADR-009](../adr/009-retire-volume-mode.md); packaging now lives in [`src/downloader/service.ts`](../../src/downloader/service.ts)).

There is no `sharp`, `jimp`, `canvas`, or `pdfkit` dependency anywhere in the project, and output formats are limited to `cbz`/`zip`. There is no code path capable of cropping or resizing a page. H2 is ruled out entirely.

## Root cause

The mangakakalot CDN pre-slices tall page images into fixed-**width** vertical tiles (1500px wide in the observed sample), each tile capped at a fixed height (1500px — the "tile cap"), with a final shorter remainder tile carrying the leftover height. Our parser ([`src/integrations/mangakakalot/client/parser.ts:238-262`](../../src/integrations/mangakakalot/client/parser.ts)) maps one `<img>` = one page, so every tile — including remainder tiles — becomes its own output page instead of being recombined into the single logical page it represents.

## Evidence

From the user's downloaded `volume-8.cbz`, chapter-027:

```
page-002 1500x1500 ┐ one logical page (2152px tall)
page-003 1500x 652 ┘
page-004 1500x1500 ┐
page-005 1500x 652 ┘
page-006 1500x1076  standalone short page (not split)
```

Whole-volume profile: 294 tiles at width 1500; heights pair perfectly (142 full tiles at 1500 with matching remainder tiles at 652), plus 10 standalone short pages at 1076, plus 4 narrow (~750px) chapter title cards that are not part of any tile group.

## Deterministic regroup rule

```
Group consecutive tiles of identical width where every tile except the last
has height == the group's max tile height (the CDN tile cap); the first tile
with height < cap closes the group. Tiles of differing width, and lone
sub-cap tiles, stay standalone.
```

This rule is deterministic — no fuzzy pixel heuristics required — and was proven clean across the entire volume 8 sample: 142 exact full/remainder pairs regrouped correctly, and all standalone pages (short pages, title cards) were left untouched.

## Why this needs a design decision

The only real fix is detect-group + vertical stitch + **re-encode** the grouped tiles into a single image. This requires introducing an image-processing library, which breaks scanldr's current byte-verbatim passthrough invariant (CDN → zip, untouched). Because this is an explicit exception to a core architectural property of the project, it is recorded as [ADR-007](../adr/007-reassemble-cdn-tiled-pages.md) rather than implemented ad hoc.

## Options considered

| # | Option | Outcome |
|---|--------|---------|
| 1 | Stitch + re-encode grouped tiles | **Recommended.** Fixes the symptom; deterministic rule; scoped exception to byte-verbatim passthrough. |
| 2 | Passthrough + document the limitation | Rejected — the bug stays; users keep seeing split pages. |
| 3 | Sidecar metadata describing tile groups | Rejected — no CBZ reader honors sidecar grouping metadata; dead end. |

## References

- [`src/integrations/mangakakalot/client/parser.ts`](../../src/integrations/mangakakalot/client/parser.ts)
- [`src/downloader/service.ts`](../../src/downloader/service.ts)
- `src/pack/pack.ts` (removed by [ADR-009](../adr/009-retire-volume-mode.md))
- Issue [#168](https://github.com/malaquiasdev/scanldr/issues/168)
- [ADR-007: Reassemble CDN vertically-tiled mangakakalot pages](../adr/007-reassemble-cdn-tiled-pages.md)
