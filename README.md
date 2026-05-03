# scanldr

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
```

## Usage

```bash
# Authenticate with Mangakakalot (one-time, launches Chromium)
bun run src/index.ts auth

# Download a volume from MangaDex
bun run src/index.ts download --volume 1 <manga-slug>

# List available volumes
bun run src/index.ts list <manga-slug>

# Watch a series for updates
bun run src/index.ts watch <manga-slug>

# Show download history
bun run src/index.ts history
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
bun run src/index.ts list <slug>

# Quiet (warn + error only)
bun run src/index.ts download --volume 1 <slug> --quiet

# JSON output (for log shippers)
bun run src/index.ts download --volume 1 <slug> --json
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
