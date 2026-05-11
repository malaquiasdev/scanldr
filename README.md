# scanldr

Single-walkthrough CLI to download manga from MangaDex and Mangakakalot, packaged as CBZ archives.

## Features

- Single interactive walkthrough — `bun start [title]`.
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
bun start "Naruto"         # walkthrough with title pre-filled
bun start --help           # show usage
bun start --version        # show version
```

### Walkthrough steps

1. **Title prompt** — free-text input; pre-filled if a positional argument was passed.
2. **Source picker** — choose MangaDex or Mangakakalot.
3. **Auth check** — if the chosen source requires auth and no valid session exists, prompts for a cURL paste; silently skipped for MangaDex.
4. **Search results** — visual numbered picker, single select.
5. **Mode picker** — Chapter or Volume.
6. **Range picker** — visual multi-select list of available chapters or volumes; no range-string parser.
7. **Pack prompt** (chapter mode only) — "Group these chapters into a single volume? [Y/n]".
8. **Cover URL** (when packing) — optional; press Enter to skip.
9. **Execute** — download images, pack into `.cbz`, write to output directory.

### How to capture a cURL (Mangakakalot)

Mangakakalot is protected by Cloudflare. The walkthrough asks you to paste a cURL command from a real browser session:

1. Open the target manga page in your browser.
2. Open DevTools (F12) and go to the **Network** tab.
3. Reload the page.
4. Right-click any request to `mangakakalot.gg` and choose **Copy as cURL**.
5. Paste the copied command into the walkthrough prompt.

The `cf_clearance` cookie extracted from the cURL is persisted to `~/.local/share/scanldr/auth.json` for the session.

## Configuration

Create a `scanldr.json` in your project directory (or in `~/.config/scanldr/scanldr.json` for a global config):

```json
{
  "db_path": "/custom/path/to/scanldr.db"
}
```

**Discovery order** (first match wins):

1. `--config <path>` flag.
2. `$SCANLDR_CONFIG` environment variable.
3. `./scanldr.json` in the current working directory.
4. `$XDG_CONFIG_HOME/scanldr/scanldr.json` (falls back to `~/.config/scanldr/scanldr.json`).

**Config keys consumed by production code:**

| Key | Default | Description |
|-----|---------|-------------|
| `db_path` | `~/.local/share/scanldr/scanldr.db` | Path to the SQLite database file |

All other keys in `DEFAULT_CONFIG` (`preferred_languages`, `download_quality`, `default_format`, `default_out`, `image_concurrency`, `chapter_delay_ms`) are validated and parsed but not read by the walkthrough code path. See [#124](https://github.com/malaquiasdev/scanldr/issues/124).

## Logging

The logger has two sinks:

- **Terminal** — human-readable output (`${ts} ${level} ${msg}\n`). This is the default.
- **Trace store** — structured rows written to the `traces` table in SQLite, with 3-day TTL and automatic redaction of cookies and auth tokens.

```bash
bun start          # human-readable terminal output (default)
bun start --json   # JSON output to stderr (for log shippers)
bun start --human  # no-op alias for back-compat
bun start -q       # suppress info logs (warn + error only)
```

The trace store is located at `<db_path>` (default: `~/.local/share/scanldr/scanldr.db`), table `traces`. Each run gets a unique `run_id` (UUID v4) for filtering.

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

## Architecture / Documentation

- [`docs/adr/006-trace-store-as-state-with-ttl.md`](docs/adr/006-trace-store-as-state-with-ttl.md) — current state architecture decision (supersedes ADR-003, withdraws ADR-004).
- [`docs/architecture_c4.md`](docs/architecture_c4.md) — C4 diagrams.
- [`docs/conventions.md`](docs/conventions.md) — code conventions.
- [`docs/adr/`](docs/adr/) — full ADR history.

## Known limitations

- [#121](https://github.com/malaquiasdev/scanldr/issues/121) — long MangaDex series (>500 chapters) silently truncated.
- [#122](https://github.com/malaquiasdev/scanldr/issues/122) — Mangakakalot synthetic chapter number when source returns null.
- [#123](https://github.com/malaquiasdev/scanldr/issues/123) — cover injection in volume mode silently skipped.
- [#124](https://github.com/malaquiasdev/scanldr/issues/124) — MangaDex adapter hardcodes language/quality, ignores user config.

## License

[MIT](LICENSE)
