# ADR-007: Reassemble CDN vertically-tiled mangakakalot pages

**Date:** 2026-07-14
**Status:** Proposed (build deferred to [#168](https://github.com/malaquiasdev/scanldr/issues/168))

**Related:**
- Scoped exception to the byte-verbatim passthrough design (CDN → zip untouched)
- Tracked by issue [#168](https://github.com/malaquiasdev/scanldr/issues/168)
- Discovery report: [mangakakalot-tiled-pages.md](../discovery/mangakakalot-tiled-pages.md)

## Context

scanldr is a byte-verbatim downloader: page bytes flow from the source CDN into the output zip untouched, with no image processing anywhere in the codebase (no `sharp`/`jimp`/`canvas`/`pdfkit`, output formats limited to `cbz`/`zip`).

mangakakalot.gg's CDN pre-slices tall page images into fixed-width vertical tiles before serving them. Our parser mirrors the source one-`<img>`-per-page, so each tile is packed as its own standalone page, producing visibly split/"cut" pages for readers. The discovery report confirms this root cause with volume-level evidence and a deterministic tile-group detection rule (see [discovery report](../discovery/mangakakalot-tiled-pages.md)).

## Decision

Introduce a page-reassembly stage that:

1. Detects tile groups using the deterministic width + height-cap rule (consecutive tiles of identical width, all but the last at the tile-cap height, closed by the first sub-cap tile).
2. Vertically stitches and re-encodes **only** the tiles within a detected group into a single output page.
3. Leaves all non-tiled pages exactly as they are today — byte-verbatim.

This is an explicit, scoped **exception** to the byte-verbatim invariant, limited strictly to detected tile groups. It requires adding an image-encode dependency (`sharp` or a lighter WebP encoder — final choice deferred to the build).

## Consequences

### Positive

- Tiled pages render as a single intended page instead of appearing split.
- Detection rule is deterministic — no fuzzy pixel heuristics, no risk of merging unrelated pages.
- Non-tiled pages (standalone short pages, title cards) remain untouched.

### Negative

- Breaks pure byte-verbatim passthrough for the subset of pages that are tiled.
- Re-encoded tiles undergo minor recompression, a quality trade-off versus the original bytes.
- Adds a new image-processing dependency and increases build weight.
- The regroup rule assumes the CDN tiling shape observed today (fixed width, fixed height cap, remainder tile); it may need revisiting if the CDN changes its tiling behavior.

### Neutral

- Whether reassembly is on by default or behind a config flag is deferred to the build.

## Alternatives Considered

- **Passthrough + document the limitation** — rejected. The bug persists and users keep seeing split pages.
- **Sidecar/grouping metadata for readers** — rejected. No CBZ reader honors sidecar grouping metadata; dead end.
- **Pixel-heuristic stitch without the dimension rule** — rejected. The width + height-cap rule is exact and proven clean across a full volume; heuristics risk merging unrelated pages incorrectly.
