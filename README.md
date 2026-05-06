<p align="center">
  <img src="assets/banner.svg" alt="scanldr" width="800"/>
</p>

[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=malaquiasdev_scanldr&metric=alert_status)](https://sonarcloud.io/dashboard?id=malaquiasdev_scanldr)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=malaquiasdev_scanldr&metric=coverage)](https://sonarcloud.io/dashboard?id=malaquiasdev_scanldr)
[![CodeQL](https://github.com/malaquiasdev/scanldr/actions/workflows/codeql.yml/badge.svg)](https://github.com/malaquiasdev/scanldr/actions/workflows/codeql.yml)

A command-line tool to download manga from MangaDex and Mangakakalot, packaged as CBZ archives.

## Features

- Download manga volumes as `.cbz` files
- Parallel image downloads with configurable concurrency
- Rate-limit handling with exponential backoff
- Cloudflare bypass via cookie replay (one-time interactive auth)
- Download history tracked in SQLite
- Subscription management (watch/unwatch series)
- Structured JSON logs for log shippers

## Requirements

- [Bun](https://bun.sh) v1.3 or later

## Installation

```bash
git clone https://github.com/malaquiasdev/scanldr.git
cd scanldr
bun install
bun link
```

## Usage

```bash
scanldr help
```

```
Commands:
  auth                           Open browser for Cloudflare bypass, save session
  list <manga>                   List volumes, chapters, languages, groups
  download <manga> --volume <n>  Download volumes (e.g. 1, 1-5, 1,3,7)
  download <manga> --chapter <n> Download chapters (same range syntax)
  update <manga>                 Download what is missing in history
  sync                           Run update for every active subscription
  watch <manga>                  Add to subscription list
  unwatch <manga>                Remove from subscription list (history kept)
  watchlist [--paused]           List subscriptions
  pause <manga>                  Skip a subscription on sync
  resume <manga>                 Re-enable a paused subscription
  import <file>                  Bootstrap subscriptions from a flat-text list
  export [--out <file>]          Dump active subscriptions as plain text
  history [--manga <m>]          Display download history
```

## Configuration

Create a `scanldr.json` in your project directory (or `~/.config/scanldr/scanldr.json` for global config):

```json
{
  "preferred_languages": ["en"],
  "download_quality": "data",
  "default_format": "cbz",
  "default_out": "./downloads",
  "image_concurrency": 4,
  "chapter_delay_ms": 500
}
```

| Field | Default | Description |
|---|---|---|
| `preferred_languages` | `["en"]` | BCP 47 language tags in priority order |
| `download_quality` | `"data"` | `"data"` or `"data-saver"` |
| `default_format` | `"cbz"` | `"cbz"` or `"zip"` |
| `default_out` | `"./downloads"` | Output directory |
| `image_concurrency` | `4` | Max parallel image downloads |
| `chapter_delay_ms` | `500` | Delay between chapters (ms) |

## Logging

```bash
# Default (info level, human format)
scanldr list <slug>

# Quiet (warn + error only)
scanldr download --volume 1 <slug> --quiet

# JSON output (for log shippers)
scanldr download --volume 1 <slug> --json
```

## Development

```bash
# Run tests
bun test

# Type check
bun run typecheck

# Lint
bun run check
```

## License

[MIT](LICENSE)
