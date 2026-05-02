# Model — Manga, Volume & Chapter

## MangaInfo

Resolved from MangaDex (primary) or a fallback site parser.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | MangaDex UUID (or site-specific slug for fallbacks) |
| `title` | `string` | Display title |
| `url` | `string` | Canonical URL. For `mangadex`: `https://mangadex.org/title/<id>`. For fallback sites: the manga page URL on the source (e.g. `https://www.mangakakalot.gg/manga/<slug>`). |
| `volumes` | `VolumeRef[]` | Ordered list of volumes with their chapters |
| `source` | `"mangadex" \| string` | Where this info was resolved from |

```ts
interface MangaInfo {
  id: string;
  title: string;
  url: string;
  volumes: VolumeRef[];
  source: string;
}
```

## VolumeRef

A volume groups one or more chapters.

| Field | Type | Description |
|---|---|---|
| `number` | `string` | Volume number as string (e.g. `"3"`, `"none"` for unvolumized) |
| `numeric` | `number` | Parsed float for sorting/range comparisons |
| `chapters` | `ChapterRef[]` | Chapters belonging to this volume |

```ts
interface VolumeRef {
  number: string;
  numeric: number;
  chapters: ChapterRef[];
}
```

## ChapterRef

A pointer to a single chapter and its available translations.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Chapter ID (MangaDex UUID or site-specific) |
| `number` | `string` | Chapter number as display string (e.g. `"18"`, `"18.5"`) |
| `numeric` | `number` | Parsed float for range comparisons |
| `url` | `string` | URL to chapter reader or image server endpoint |
| `language` | `string` | BCP 47 language code (e.g. `"en"`, `"pt-BR"`) |
| `scanlationGroup` | `string \| undefined` | Name of the scanlation group (MangaDex only) |

```ts
interface ChapterRef {
  id: string;
  number: string;
  numeric: number;
  url: string;
  language: string;
  scanlationGroup?: string;
}
```

## DownloadOptions

Options passed to the downloader.

| Field | Type | Default | Description |
|---|---|---|---|
| `outDir` | `string` | `./download` | Output directory |
| `format` | `"cbz" \| "zip"` | `"cbz"` | Archive format |
| `imageConcurrency` | `number` | `4` | Parallel image downloads per chapter |
| `delayMs` | `number` | `1000` | Delay between chapters (ms) |
| `force` | `boolean` | `false` | Re-download even if already in history (CLI: `--force`) |
| `dryRun` | `boolean` | `false` | Log actions without writing files or updating history |

```ts
interface DownloadOptions {
  outDir: string;
  format: "cbz" | "zip";
  imageConcurrency: number;
  delayMs: number;
  force: boolean;
  dryRun: boolean;
}
```
