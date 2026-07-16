# Go Reimplementation Feasibility — Discovery Report

**Date:** 2026-07-16
**Status:** Discovery complete — spike done, no code committed
**Recommendation:** **Feasible with low image-friction; gate on a real product need for standalone-binary distribution before committing to a full rewrite.**

## Executive summary

scanldr (Bun + TypeScript CLI) could be reimplemented in Go with equivalent or better ergonomics for CLI, HTTP, HTML parsing, archives, SQLite, and concurrency. The one open question — reassembling CDN-tiled webp page images without shelling out to libvips/libwebp (the #168 tiling logic) — is answered by a spike: a cgo-free, cross-compilable Go path exists (`gen2brain/webp`, libwebp-via-WASM) that reaches lossy webp at size parity with the current `sharp` output. This removes the earlier assumption that a Go rewrite would be forced into cgo (and its system-dependency / cross-compile costs). The rewrite is real work — it discards the existing test suite and the implementation embodied in the 9 ADRs — and is only worth doing if standalone-binary distribution or I/O throughput is an actual goal, not because "Go is nicer."

## 1. Current stack (what a Go rewrite must replace)

- Runtime: Bun + TypeScript; single interactive CLI walkthrough (`bun start`), no subcommands.
- Interactive prompts: `@inquirer/prompts`.
- HTTP with Cloudflare cURL-paste auth (`cf_clearance` cookie); a fallback-http layer with a per-lane CF short-circuit latch.
- HTML parsing: `cheerio`.
- Image: `sharp` (libvips) — decodes CDN-tiled webp page tiles, composites them vertically, re-encodes webp (the #168 tiled-page reassembly).
- Archives: `fflate` (cbz/zip).
- SQLite `traces` table (3-day TTL, ADR-006).
- stderr progress bar; concurrent per-page fetch with out-of-order completion.

## 2. Component → Go mapping

| Concern | scanldr today | Go equivalent | Verdict |
|---|---|---|---|
| CLI / prompts | `@inquirer/prompts` | `charmbracelet/bubbletea` or `AlecAivazis/survey` | Equivalent |
| HTTP + CF cookie (cURL paste) | fallback-http + manual cookie header | `net/http` + `http.CookieJar` | Simpler (native) |
| HTML parse | `cheerio` | `PuerkitoBio/goquery` | Direct analog |
| CBZ / ZIP | `fflate` | `archive/zip` (stdlib) | Better — stdlib, no dep |
| SQLite (`traces`, ADR-006) | `bun:sqlite` | `modernc.org/sqlite` (pure Go) or `mattn/go-sqlite3` (cgo) | Fine either way |
| Concurrency (fetch semaphore, out-of-order completion) | JS semaphore + Promise bookkeeping | goroutines + `golang.org/x/sync/errgroup` + channels | Cleaner |
| Progress bar | stderr progress indicator (#108) | `vbauerster/mpb` | Fine |
| Image webp reassembly | `sharp` (libvips) | see spike below | The one real question |

## 3. The image spike (real numbers)

Environment: go1.26 (darwin/arm64), clean machine with **no** libwebp/libvips/cwebp installed. Fixture: two real 1500-wide webp tiles from a downloaded volume cbz; stitch target 1500x4304; original lossy webp bytes ≈ 1.13 MB.

- **Pure-Go decode** (`golang.org/x/image/webp`) + **vertical composite** (stdlib `image` / `image/draw`, ~5 lines): trivial, dimensions verified correct.
- **PoC A — pure Go, encode PNG** (`CGO_ENABLED=0` builds; 3.15 MB static binary): correct dims but output PNG ≈ 6.21 MB (~5.5x the original webp) and wrong format for the reader pipeline.
- **PoC B1 — `github.com/HugoSmits86/nativewebp`**: true pure Go, `CGO_ENABLED=0` builds, valid webp, smallest binary (2.97 MB), but **lossless-only (VP8L)** → ≈ 3.31 MB (~2.9x original). No quality knob.
- **PoC B2 — `github.com/gen2brain/webp`**: libwebp compiled to WASM, run via `wazero` — `CGO_ENABLED=0` builds, no system lib / no C toolchain. Valid **lossy** webp; **q80 ≈ 1.19 MB, size-parity with the 1.13 MB source**. Binary 7.34 MB; ~1s/page encode (WASM interpreter overhead, acceptable for batch downloads). Closest drop-in to `sharp` while staying cgo-free and cross-compilable.
- **cgo contrast:** `kolesa-team/go-webp` needs system libwebp (build **FAILS** on the clean machine: `Package 'libwebp' was not found in the pkg-config search path` → requires `brew install webp`); `chai2010/webp` vendors libwebp C source so it builds with `CGO_ENABLED=1` but **fails with `CGO_ENABLED=0`** → forfeits clean cross-compile / static musl builds.

## 4. Verdict and recommendation

- Go is viable and, in several areas, a better fit for a CLI downloader: single static binary (no runtime install for the user), native http/zip/sqlite, superior concurrency primitives.
- The image step — earlier assumed to force cgo — does **not**: `gen2brain/webp` gives cgo-free, cross-compilable, lossy webp at size parity. Recommended default for the stitch. Trade-off: +~4 MB binary, ~1s/page CPU.
- Ranked options for the webp encode:
  1. `gen2brain/webp` (best fidelity/format, cgo-free) — recommended.
  2. `nativewebp` (pure Go, lossless-only, smallest binary).
  3. Pure-Go + PNG output (format change, 5.5x size bloat).
  4. cgo libwebp/libvips (matches `sharp` exactly, fastest, but loses static-binary/cross-compile — the very thing motivating the rewrite).
- Honest cost: this is a **rewrite**, not a port — it discards the current test suite, the 9 ADRs' implementation, and momentum. Justified if the goal is standalone-binary distribution or I/O performance; not justified if "it already works."
- Recommendation: Go is feasible with low image-friction; recommend a decision gate — only pursue if standalone-binary distribution is a real product goal. If pursued, prototype the mangakakalot adapter + the `gen2brain/webp` stitch first (the two riskiest parts) before committing further.

## References

- Tiling/reassembly logic: [`src/downloader/reassemble.ts`](../../src/downloader/reassemble.ts)
- Cloudflare cookie / fallback HTTP layer: [`src/integrations/fallback-http/`](../../src/integrations/fallback-http/)
- ADR-006 (SQLite `traces` TTL) and ADR-007 — see `docs/adr/`
- Go libraries evaluated: [`golang.org/x/image/webp`](https://pkg.go.dev/golang.org/x/image/webp), [`github.com/HugoSmits86/nativewebp`](https://github.com/HugoSmits86/nativewebp), [`github.com/gen2brain/webp`](https://github.com/gen2brain/webp), [`github.com/kolesa-team/go-webp`](https://github.com/kolesa-team/go-webp), [`github.com/chai2010/webp`](https://github.com/chai2010/webp), [`github.com/PuerkitoBio/goquery`](https://github.com/PuerkitoBio/goquery), [`modernc.org/sqlite`](https://gitlab.com/cznic/sqlite), [`golang.org/x/sync/errgroup`](https://pkg.go.dev/golang.org/x/sync/errgroup), [`github.com/vbauerster/mpb`](https://github.com/vbauerster/mpb)
