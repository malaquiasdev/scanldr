<p align="center">
  <img src="assets/banner.svg" alt="scanldr" width="800"/>
</p>

# scanldr

Single-walkthrough CLI to download manga from MangaDex and Mangakakalot, packaged as CBZ archives.

## Features

- Single interactive walkthrough — `bun start`.
- Two sources: MangaDex (no auth) and Mangakakalot (cURL paste for Cloudflare bypass).
- Visual pickers for source, search results, mode (chapter/volume), and range — no flag-based syntax.
- Optional packing of selected chapters into a single CBZ with optional cover injection.
- Structured 3-day trace store in SQLite for debug/post-mortem.
- Human-readable terminal output by default; `--json` flag for structured stderr.

## Requirements

- [Bun](https://bun.sh) v1.x or later

## Installation

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

The walkthrough guides you through title search, source selection, Cloudflare auth (Mangakakalot only), mode/range picking, and optional packing. See [docs/flows/download_flow.md](docs/flows/download_flow.md) for the full step-by-step and sequence diagram, and [docs/auth-manual.md](docs/auth-manual.md) for how to capture a Mangakakalot cURL session.

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

- [#121](https://github.com/malaquiasdev/scanldr/issues/121) — long MangaDex series (>500 chapters) silently truncated.
- [#122](https://github.com/malaquiasdev/scanldr/issues/122) — Mangakakalot synthetic chapter number when source returns null.
- [#123](https://github.com/malaquiasdev/scanldr/issues/123) — cover injection in volume mode silently skipped.
- [#124](https://github.com/malaquiasdev/scanldr/issues/124) — MangaDex adapter hardcodes language/quality, ignores user config.

## License

[MIT](LICENSE)
