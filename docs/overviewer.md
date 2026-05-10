# Technical Specification: scanldr

## 1. Overview
**Project:** scanldr — offline downloader for manga, HQ, manhwa, and webtoon.
**Repository:** [`malaquiasdev/scanldr`](https://github.com/malaquiasdev/scanldr)
**Goal:** A CLI tool that downloads complete volumes from scanlation sources and packages them as `.cbz` or `.zip` files for offline reading. MangaDex is the primary source for both metadata (volume→chapter mapping) and downloads. Other sites (mangakakalot.gg, etc.) act as user-selected fallbacks when a title or language is not available on MangaDex.

## 2. Repository Structure

```
scanldr/
├── src/
│   ├── index.ts                  # CLI entrypoint — arg parsing, command routing
│   ├── history.ts                # SQLite download history
│   ├── downloader.ts             # Parallel image download + CBZ/ZIP packaging
│   ├── utils.ts                  # Logger, URL normalization, chapter selectors
│   ├── types.ts                  # Shared types
│   └── sites/
│       ├── mangadex/
│       │   ├── client.ts         # MangaDex API client (REST, no auth required)
│       │   └── parser.ts         # Maps API responses to internal types
│       └── mangakakalot/
│           ├── client.ts         # HttpClient with Cloudflare cookie replay
│           └── parser.ts         # HTML/JSON extraction (Cheerio)
├── integrations/
│   └── mangakakalot/
│       └── auth/
│           ├── service.ts        # runAuth — parses cURL paste, verifies session, writes auth.json
│           ├── parser.ts         # parseCurl — extracts URL, cookies, User-Agent from cURL string
│           └── types.ts          # AuthError, RunAuthOptions, ParsedCurl
├── docs/                         # This documentation
├── scanldr.db                    # SQLite — download history + subscriptions (gitignored)
└── $XDG_DATA_HOME/scanldr/auth.json  # Saved Cloudflare session (mode 0600, outside repo)
```

## 3. Component Definitions

### 3.1. CLI (`src/index.ts`)
- Parses arguments via `node:util parseArgs`
- Routes to one of: `auth`, `list`, `download`, `update`, `sync`
- Orchestrates source resolution: MangaDex first, fallback prompt if needed

### 3.2. MangaDex Client (`src/sites/mangadex/client.ts`)
- Calls the public MangaDex REST API (no authentication required)
- Resolves title → manga ID → volumes → chapters
- Presents available language/scanlation group options to the user before downloading
- Downloads chapter images directly from MangaDex image servers

### 3.3. Fallback Sites (`src/sites/<site>/`)
- Each fallback site is a self-contained module with its own `client.ts` and `parser.ts`
- When MangaDex does not have a title or the available languages are not acceptable, the CLI lists configured fallback sites and prompts the user to choose one
- Volume metadata from MangaDex is still used to determine the chapter range even when downloading from a fallback site

### 3.4. Auth (`src/integrations/mangakakalot/auth/`)
- Used **only** in the `auth` command for sites that require Cloudflare bypass
- User opens the site in a real browser, solves the Turnstile, then copies the request via DevTools "Copy as cURL" and pastes it into the CLI prompt
- The CLI parses cookies and User-Agent from the paste, verifies the session against the parsed URL, then writes `auth.json` atomically (mode 0600)
- Not used for MangaDex (no Cloudflare). See `docs/auth-manual.md` for step-by-step instructions.

### 3.5. Download History (`src/history.ts`)
- SQLite database via `bun:sqlite` (zero extra dependencies)
- Records every downloaded chapter: manga ID, volume, chapter number, source, language, timestamp
- Used by `update` and `sync` to skip already-downloaded volumes and chapters regardless of whether output files still exist on disk
- Survives output directory cleanup — the user can delete `.cbz` files freely without losing track of what was downloaded

### 3.6. Downloader (`src/downloader.ts`)
- Downloads chapter images in parallel (configurable concurrency)
- Packages images into `.cbz` or `.zip` using `fflate`
- One `.cbz` per volume when downloading by volume (grouping all chapters into a single archive)
- One `.cbz` per chapter when downloading by chapter (e.g. `one-piece-chapter-001.cbz`)
- File naming: volumes → `<title-slug>-volume-<nnn>.cbz`, chapters → `<title-slug>-chapter-<nnn>.cbz` (zero-padded to 3 digits, e.g. `001`, `018`, `103`)
- `<title-slug>` is the manga title lowercased, ASCII-folded, with non-alphanumerics replaced by `-` and consecutive dashes collapsed (e.g. "Witch Hat Atelier" → `witch-hat-atelier`, "JoJo's Bizarre Adventure" → `jojo-s-bizarre-adventure`)

## 4. CLI Commands

| Command | Description |
|---|---|
| `scanldr auth` | Capture session via DevTools "Copy as cURL" paste, saves session (~30 days) |
| `scanldr list <manga>` | Lists all available volumes, chapters, languages, and scanlation groups |
| `scanldr list <manga> --volume <n>` | Lists chapters within a specific volume |
| `scanldr list <manga> --chapter <n>` | Lists details of a specific chapter |
| `scanldr download <manga> --volume <n>` | Downloads one or more volumes (e.g. `1`, `1-5`, `1,3,7`, `1-5,8,10`) |
| `scanldr download <manga> --volume <n> --force` | Re-downloads volumes even if already in history |
| `scanldr download <manga> --chapter <n>` | Downloads one or more chapters (same syntax as `--volume`) |
| `scanldr download <manga> --chapter <n> --force` | Re-downloads chapters even if already in history |
| `scanldr update <manga>` | Downloads volumes and chapters not yet in history |
| `scanldr sync` | Runs `update` for every active subscription |
| `scanldr watch <manga> [--source <s>]` | Add to subscription list |
| `scanldr unwatch <manga> [--source <s>]` | Remove from subscription list (history is kept) |
| `scanldr watchlist [--paused]` | List subscriptions |
| `scanldr pause <manga>` / `scanldr resume <manga>` | Toggle `paused` flag (paused subs are skipped by `sync`) |
| `scanldr import <file>` | Bootstrap subscriptions from a flat-text list (e.g. legacy `mangas.txt`) |
| `scanldr export [--out <file>]` | Dump active subscriptions as plain text |
| `scanldr history [--manga <m>] [--source <s>] [--limit <n>]` | List download history sorted by date DESC; default limit 50, `--limit 0` = unlimited |
| `scanldr history clear [--manga <m>] [--source <s>] [--yes]` | Delete history records; interactive confirmation by default; `--yes` skips prompt |

> `--volume` and `--chapter` are mutually exclusive. Passing both is a CLI error.

### 4.1 `list` → `download` Workflow

Use `list` to discover volume and chapter numbers, then pass them directly to `download`:

```sh
scanldr list "One Piece"               # discover available volumes and chapters

scanldr download "One Piece" --volume 1        # single volume
scanldr download "One Piece" --volume 1-5      # range
scanldr download "One Piece" --volume 1,3,7    # specific volumes
scanldr download "One Piece" --volume 1-5,8,10 # range + specific

scanldr download "One Piece" --chapter 1       # single chapter
scanldr download "One Piece" --chapter 1-10    # range
scanldr download "One Piece" --chapter 1,5,9   # specific chapters
```

#### Range grammar

`--volume` and `--chapter` accept the following grammar:

```
range_set := element ("," element)*
element   := number | number "-" number
number    := positive integer or fractional (e.g. "12", "12.5")
```

Resolution rules:

- Whitespace around commas and dashes is **not** allowed (`1, 2` is an error). Quote the value if your shell expands it.
- Each `element` is resolved against what the source actually has. Missing items in the middle of a range (e.g. chapter 8.5 doesn't exist on the chosen language) are silently skipped, **not** an error.
- A range whose lower bound is greater than the upper bound (`5-3`) is a CLI error.
- Duplicates across elements are deduped (`1-3,2` resolves to `{1, 2, 3}`).
- Empty range (`""`, leading/trailing comma like `,1`, dangling dash like `1-`) is a CLI error.
- Fractional volumes are valid (`"none"` is a special token that matches MangaDex's "no volume" bucket — pass it lowercased: `--volume none`).

### 4.2 `list` Output Examples

**`scanldr list "One Piece"`**
```
One Piece (id: a1c7c817-4e59-43b7-9365-09675a149a6f)
Languages available: en, pt-BR

Volume 1
  Chapter 1  — Romance Dawn
  Chapter 2  — They Call Him "Straw Hat Luffy"
  Chapter 3  — Morgan versus Luffy

Volume 2
  Chapter 9  — Versus Cabaji!!
  Chapter 10 — Incident at the Bar
  ...

Groups: [TCB Scans] [Manga Plus]
```

**`scanldr list "One Piece" --volume 1`**
```
One Piece — Volume 1
  Chapter 1  — Romance Dawn
  Chapter 2  — They Call Him "Straw Hat Luffy"
  Chapter 3  — Morgan versus Luffy
  Chapter 4  — Marine Captain "Axe-Hand" Morgan
  ...
```

**`scanldr list "One Piece" --chapter 1`**
```
One Piece — Chapter 1: Romance Dawn
Volume:    1
Pages:     53
Language:  en
Group:     TCB Scans
Published: 1997-07-22
```

### 4.3 Common Flags

Flags that apply across commands. CLI flags always override `scanldr.json`.

| Flag | Applies to | Default | Description |
|---|---|---|---|
| `--out <dir>` | `download`, `update`, `sync` | `default_out` | Output directory for `.cbz` / `.zip` files |
| `--format <cbz\|zip>` | `download`, `update`, `sync` | `default_format` | Archive format |
| `--quality <data\|data-saver>` | `download`, `update`, `sync` | `download_quality` | MangaDex image quality. `data` = full, `data-saver` = compressed. Ignored on fallback sites. |
| `--concurrency <n>` | `download`, `update`, `sync` | `image_concurrency` | Parallel image downloads per chapter |
| `--force` | `download`, `update` | `false` | Re-download even if already in history |
| `--no-track` | `download`, `update` | `false` | Run without writing to download history |
| `--dry-run` | `download`, `update`, `sync` | `false` | Log actions without writing files or touching history |
| `--strict` | `sync` | `false` | Exit non-zero if any subscription was skipped or errored (cron-friendly alerting) |
| `--source <site>` | `watch`, `unwatch` | `mangadex` | Subscription source |
| `--paused` | `watchlist` | omits paused | Include paused subscriptions in the listing |
| `--manga <m>` | `history`, `history clear` | all | Filter history by manga title (LIKE `%m%` case-insensitive) |
| `--source <s>` | `history`, `history clear` | all | Filter history by source (`mangadex` / `mangakakalot`) |
| `--limit <n>` | `history` | `50` | Max rows to display; `0` = unlimited |
| `--yes` | `history clear` | `false` | Skip interactive confirmation (for scripts / CI) |
| `--out <file>` | `export` | stdout | File to write the watchlist export to |

> Mutual exclusion: `--volume` and `--chapter` cannot be combined on `download` / `list`.

## 5. Configuration File (`scanldr.json`)

Avoids repetitive prompts for settings the user rarely changes.

### Discovery order

The CLI looks for `scanldr.json` in this order on every invocation, stopping at the first match:

1. Path passed via `--config <path>` (if set).
2. `$SCANLDR_CONFIG` environment variable (if set).
3. `./scanldr.json` in the current working directory.
4. `$XDG_CONFIG_HOME/scanldr/scanldr.json` (or `~/.config/scanldr/scanldr.json` if `XDG_CONFIG_HOME` is not set).

If no config is found, all defaults from the table below apply. Missing individual fields fall back to their defaults — partial configs are valid.

```json
{
  "preferred_languages": ["en", "pt-BR"],
  "download_quality": "data",
  "default_format": "cbz",
  "default_out": "./download",
  "image_concurrency": 4,
  "chapter_delay_ms": 1000
}
```

| Field | Default | Description |
|---|---|---|
| `preferred_languages` | `["en", "pt-BR"]` | BCP 47 codes in priority order. CLI only prompts if none are available. |
| `download_quality` | `"data"` | `"data"` (high quality) or `"data-saver"` (compressed). MangaDex only. |
| `default_format` | `"cbz"` | `"cbz"` or `"zip"` |
| `default_out` | `"./download"` | Output directory |
| `image_concurrency` | `4` | Parallel image downloads per chapter |
| `chapter_delay_ms` | `1000` | Delay between chapters (ms) |

CLI flags always override config file values.

## 6. Source Resolution Strategy

```
1. Search MangaDex for the title
2. If found → show available languages and scanlation groups → user picks
3. Download from MangaDex

If title not found on MangaDex OR user rejects all available languages:
4. CLI warns: "Not available on MangaDex with acceptable language."
5. CLI lists configured fallback sites → user picks one
6. Volume metadata from MangaDex still used for chapter range (if available)
7. Download from chosen fallback site
```

## 7. MangaDex API Constraints

- **Rate limit:** ~5 requests/second. The downloader must respect this with a configurable delay between chapter requests.
- **Image quality:** Two tiers available via `/at-home/server/:chapterId` — `data` (full quality) and `data-saver` (compressed). Controlled by `download_quality` in config or `--quality` flag.
- **Image naming:** Pages must be saved with zero-padded sequential names (e.g. `0001.png`, `0002.png`) to guarantee correct sort order in any CBZ reader.
- **Retry policy:** Up to 5 attempts per failed image. On failure, re-fetch `/at-home/server/:chapterId` to get a fresh CDN URL before retrying — do not retry the same stale URL.
- **At-home server reporting:** Per MangaDex terms of use, the client must report download success/failure metrics back to the API (`x-cache` header, duration). This is mandatory, not optional.
- **Temporary files:** Images and archives are written to a `.temp` file and renamed to the final path only on successful completion. Prevents corrupted CBZ files if the process is interrupted.

## 8. Multi-Site Strategy

The list of available fallback sites is **hardcoded** in `src/sites/`. There is no runtime registration, no plugin loader, and no `fallback_sites` field in `scanldr.json`. Adding a site requires shipping a new release.

When `download` resolves to a fallback path, the CLI presents every site under `src/sites/` (excluding `mangadex`, which is the primary) as a numbered choice. The user always picks explicitly — no auto-selection.

Each new site requires an individual study before implementation:

1. Identify the Cloudflare protection level (Turnstile, BotFight, etc.)
2. Determine bypass strategy (cookie replay or other)
3. Implement a dedicated module under `src/sites/<site>/`
4. Document the bypass strategy in a new ADR

## 9. Logging

Every command writes structured logs to stderr; the only thing that goes to stdout is user-facing output (tables, prompts, the bytes of `scanldr export`). Pipes (`scanldr list ... | grep ...`) work as expected.

| Level | Purpose |
|---|---|
| `error` | Unhandled failure. Operation aborted. Non-zero exit. |
| `warn`  | Handled failure — operation continued (rate-limit retry, network error with backoff, fallback used). |
| `info`  | Default level. One line per chapter / per stage. |

Flags:

| Flag | Effect |
|---|---|
| `--quiet` / `-q` | Raise the threshold to `warn`. Info lines are suppressed. |
| `--json` | No-op alias kept for backward compatibility. JSON is the default format. |
| `--human` | Switch to human-readable format: `<ts> <level> <msg> <fields-json>`. Fields are appended as a JSON object; omitted when empty. Sensitive keys are still redacted. |

All log lines follow the pino convention: structured fields first, human message last — `logger.warn({ event, context, ...fields }, msg)`.

## 10. CI/CD & Quality

The project adopts a layered quality and security stack. See [docs/ci-cd.md](ci-cd.md) for the full stack rationale, local execution commands, and manual prerequisite steps.

## 11. Future Considerations

- **REST API mode:** expose core commands as HTTP endpoints for integration with other tools or UIs
- **TUI:** interactive terminal interface for browsing and selecting volumes
- **Additional output formats:** PDF (via image stacking)
