<p align="center">
  <img src="assets/banner.svg" alt="scanldr" width="800"/>
</p>

# scanldr

Single-walkthrough CLI to download manga from Mangakakalot, one chapter per CBZ archive by default, with optional grouping into a single volume CBZ.

## Features

- Single interactive walkthrough — `bun start`.
- Single source: Mangakakalot — Cloudflare bypass via an undetected browser (patchright) capture, with a manual cURL-paste fallback — every run requires auth.
- Visual pickers for search results and chapter range — no flag-based syntax.
- Automatic reassembly of CDN vertically-tiled pages into single, unsplit pages.
- Coordinated stderr progress bar showing the current chapter (e.g. `Chapter 33 [3/5]`).
- Post-download loop — queue more downloads without restarting the walkthrough.
- Structured 3-day trace store in SQLite for debug/post-mortem.
- Human-readable terminal output by default; `--json` flag for structured stderr.

## Requirements

- [Bun](https://bun.sh) v1.x or later

## Installation

### Stable (recommended)

Clone the repo and check out the latest release tag (see [releases](https://github.com/malaquiasdev/scanldr/releases), tagged as `vX.Y.Z`, e.g. `v1.2.0`):

```bash
git clone https://github.com/malaquiasdev/scanldr.git
cd scanldr
git checkout "$(git tag --sort=-v:refname | head -n1)"   # latest stable release
bun install
```

### Development (bleeding edge)

Staying on `main` gives you the latest unreleased changes, but it may be unstable:

```bash
git clone https://github.com/malaquiasdev/scanldr.git
cd scanldr
bun install
```

## Usage

There are no subcommands. Everything is a prompt.

```bash
bun start                  # interactive walkthrough
bun start --help           # show usage
bun start --version        # show version
```

The walkthrough guides you through title search, Cloudflare auth (undetected-browser capture via patchright, with a manual cURL-paste fallback), chapter range picking, and download, then loops back to let you queue another download without restarting. See [docs/flows/download_flow.md](docs/flows/download_flow.md) for the full step-by-step and sequence diagram, and [docs/auth-manual.md](docs/auth-manual.md) for how the Mangakakalot session is captured.

## Development

```bash
bun test
bun run typecheck
bun run check
```

Dev loop with file watching:

```bash
bun --watch run src/index.ts
```

## Documentation

- [docs/SUMMARY.md](docs/SUMMARY.md) — full documentation index.
- [docs/configuration.md](docs/configuration.md) — config file and env vars.
- [docs/logging.md](docs/logging.md) — logging sinks and flags.
- [docs/auth-manual.md](docs/auth-manual.md) — capturing a Cloudflare session.
- [docs/architecture_c4.md](docs/architecture_c4.md) — C4 diagrams.
- [docs/conventions.md](docs/conventions.md) — code conventions.
- [docs/adr/](docs/adr/) — architecture decision records.

## Known limitations

See the [issue tracker](https://github.com/malaquiasdev/scanldr/issues) for currently open limitations.

## License

[MIT](LICENSE)
