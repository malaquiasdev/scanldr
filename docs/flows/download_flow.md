# Flow — Download

## Current walkthrough (`bun start`)

The current single-walkthrough CLI (post-epic #116, chapter-selection-only since
[ADR-009](../adr/009-retire-volume-mode.md); chapter→volume grouping restored by
[ADR-010](../adr/010-restore-chapter-volume-grouping.md)) runs these steps:

1. **Title prompt** — free-text input ("Manga title:").
2. **Source picker** — auto-selects Mangakakalot, the sole registered source (see [ADR-008](../adr/008-retire-mangadex-source.md); MangaDex was retired).
3. **Auth check** — Mangakakalot requires auth, so every run prompts for a cURL paste when no valid session exists.
4. **Search results** — visual numbered picker, single select.
5. **Range picker** — visual multi-select list of available chapters; no range-string parser, no mode choice (chapter is the only *discovery* mode — see ADR-009).
6. **Pack prompt** — "Group these chapters into a single volume?" (yes/no). This is the
   only place volume grouping re-enters the flow (ADR-010); it never resurrects a
   discovery-time chapter/volume mode choice.
   - **No** → one `.cbz` per chapter (unchanged since ADR-009).
   - **Yes** → **volume name prompt** (optional, Enter keeps a chapter-range-derived default)
     then **cover URL prompt** (optional, Enter skips).
7. **Execute** — download images for each selected chapter, writing each as its own `.cbz`.
   When grouping was requested, the per-chapter `.cbz` files are then packed into a single
   volume `.cbz` (custom or chapter-range-derived name) with the optional cover injected —
   and, once the volume is successfully written, the loose per-chapter `.cbz` files that
   were packed into it are deleted, so only the single volume `.cbz` remains on disk
   (a per-file deletion failure is warn-logged and does not fail the run).

See [docs/auth-manual.md](../auth-manual.md) for step 3 in detail.

## Historical `download` command (pre-epic #116)

> This section describes the legacy multi-command CLI, which used MangaDex as its primary
> source — retired by [ADR-008](../adr/008-retire-mangadex-source.md). Kept as historical record.

Covers the `download` command. The CLI always resolves metadata via MangaDex first. If the title or an acceptable language is not available, the user is prompted to choose a fallback site.

The download history (SQLite) is checked before any network request — already-downloaded volumes are skipped regardless of whether the output files still exist on disk.

## Sequence Diagram

> **Historical (pre-ADR-008/009)** — describes the retired MangaDex source and volume mode.

```mermaid
sequenceDiagram
    actor User
    participant CLI as scanldr CLI
    participant History as history.ts (SQLite)
    participant MDX as MangaDex API
    participant Fallback as Fallback Site
    participant Out as ./download/ (output)

    User->>CLI: scanldr download "witch hat atelier" --volume 3

    CLI->>History: is volume 3 already downloaded?
    History-->>CLI: no

    CLI->>MDX: search title → GET /manga?title=...
    MDX-->>CLI: manga candidates

    CLI->>MDX: GET /manga/:id/aggregate (volume → chapter mapping)
    MDX-->>CLI: { volume: "3", chapters: ["18","19","20","21"] }

    CLI->>MDX: GET /manga/:id/feed?volume=3 (available translations)
    MDX-->>CLI: available languages + scanlation groups

    CLI-->>User: "Volume 3 available in:\n  [1] en — Group Alfa\n  [2] pt-BR — Group Beta\nPick one:"
    User->>CLI: 1

    loop for each chapter in volume 3
        CLI->>MDX: GET /at-home/server/:chapterId (image URLs)
        MDX-->>CLI: image server + page list
        loop images in parallel (--concurrency, default 4)
            CLI->>MDX: GET image
            MDX-->>CLI: image bytes
        end
    end

    CLI->>Out: write "witch-hat-atelier-volume-003.cbz" (rename .temp → final)
    CLI->>History: BEGIN TRANSACTION
    loop for each chapter packaged into the volume
        CLI->>History: INSERT { mangaId, volume, chapterId, chapterNum, source, language, downloadedAt }
    end
    CLI->>History: COMMIT
    CLI-->>User: done

    Note over CLI,Fallback: === FALLBACK PATH (MangaDex unavailable or language rejected) ===

    alt title not found on MangaDex OR user rejects all languages
        CLI-->>User: "Not available on MangaDex with an acceptable language.\nFallback sites:\n  [1] mangakakalot.gg\nPick one or cancel:"
        User->>CLI: 1
        CLI->>Fallback: search title → resolve slug

        alt reason == all_external AND --volume mode (Shueisha/MangaPlus partner titles)
            Note over CLI,Fallback: MangaDex aggregate is empty for these titles.<br/>Source volume→chapter mapping from fallback site manga page (volumeMappingSource='fallback').
            CLI->>Fallback: GET /manga/<slug> (manga detail page)
            Fallback-->>CLI: HTML with "Vol.X Ch.Y" chapter list
            CLI->>CLI: parseVolumeMapping(html) → VolumeMap [{ volume, chapters[] }]
            Note over CLI: if VolumeMap is empty → CliError "use --chapter instead"<br/>if requested volume not in map → CliError with available volumes list
        else reason == all_external AND --chapter mode
            Note over CLI,Fallback: volumeMappingSource='mangadex' (uses JSON API, not HTML parser).<br/>getChapterList() is reliable for chapter lookups; getVolumeMap() (HTML) returns<br/>0 buckets for real Shueisha titles (selector drift / DMCA redirect).
            CLI->>Fallback: GET /api/manga/<slug>/chapters → ChapterRef[]
        else reason == title_not_found OR no_chapters_in_lang
            Note over CLI,Fallback: volume range sourced from MangaDex aggregate if available,<br/>otherwise user must pass --chapter manually (volumeMappingSource='mangadex')
            CLI->>Fallback: GET /api/manga/<slug>/chapters → ChapterRef[]
        end

        loop for each chapter in volume range
            CLI->>Fallback: download chapter images
            Fallback-->>CLI: image bytes
        end
        CLI->>Out: write "witch-hat-atelier-volume-003.cbz" (rename .temp → final)
        CLI->>History: BEGIN TRANSACTION
        loop for each chapter packaged into the volume
            CLI->>History: INSERT { mangaId, volume, chapterId, chapterNum, source: "mangakakalot", language: "en", downloadedAt }
        end
        CLI->>History: COMMIT
        CLI-->>User: done
    end
```

## Current Output Structure (chapter-only)

```
./download/
└── witch-hat-atelier/
    ├── witch-hat-atelier-chapter-018.cbz
    ├── witch-hat-atelier-chapter-019.cbz
    └── witch-hat-atelier-chapter-020.cbz
```

Each selected chapter is written as its own `.cbz` archive, pages sorted and zero-padded within the chapter. See ADR-009.

## Historical: Volume Output Structure (pre-ADR-009)

> Volume grouping was withdrawn by [ADR-009](../adr/009-retire-volume-mode.md). Kept as historical record.

```
./download/
└── witch-hat-atelier/
    ├── witch-hat-atelier-volume-001.cbz
    ├── witch-hat-atelier-volume-002.cbz
    └── witch-hat-atelier-volume-003.cbz
```

All chapters belonging to a volume were merged into a single `.cbz` archive, sorted by chapter and page number.

## Decisions

> **Historical (pre-ADR-008/009)** — describes the retired MangaDex source and volume mode.

1. **History check before any network call** — avoids unnecessary requests for already-downloaded volumes. A volume counts as "already downloaded" only when **all** its chapters (for the chosen language) are present in `downloads`.
2. **History writes are atomic per volume** — chapters are accumulated in memory while downloading; once the `.cbz` is renamed from `.temp` to its final path, all chapter rows are inserted in a single SQLite transaction. Either every chapter of the volume lands in history or none does — no orphan rows pointing at a volume archive that was never produced.
3. **Preferred languages from config** — CLI only prompts for language selection when none of the user's `preferred_languages` (from `scanldr.json`) are available. If a preferred language is found, it is used silently.
4. **User always picks fallback** — CLI never silently falls back to another site. Always warns and prompts.
5. **Volume metadata source depends on fallback reason AND mode** — `volumeMappingSource` is set as follows:
   - `'fallback'` (HTML parser, `getVolumeMap`): only when reason is `all_external` **AND** `--volume` flag is set. The MangaDex aggregate is empty for these titles, so the CLI parses the fallback site manga page to map volumes → chapters.
   - `'mangadex'` (JSON API, `getChapterList`): all other cases — including `--chapter` with `all_external`. `getVolumeMap` (HTML parser) returns 0 buckets for real Shueisha titles (Dandadan, JJK, Spy x Family) due to selector drift or DMCA redirects; `getChapterList` (JSON API) is stable and sufficient for chapter-mode lookups.
   - **Invariant**: `volumeMappingSource='fallback'` with `--chapter` mode is explicitly forbidden and throws `CliError("Internal: chapter-mode with volumeMappingSource='fallback' is not supported...")`.
6. **`--chapter` as escape hatch** — when volume metadata is unavailable, the user can pass `--chapter 18-21` manually.
7. **One `.cbz` per volume** — all chapters in the volume are merged into a single archive.
8. **Zero-padded image filenames** — pages saved as `0001.png`, `0002.png`, etc. to guarantee correct sort order in all CBZ readers.
9. **Retry with re-fetch** — up to 5 attempts per failed image. On each failure, re-fetches `/at-home/server/:chapterId` to get a fresh CDN URL before retrying. Retrying a stale URL is not sufficient.
10. **MangaDex rate limiting** — maximum ~5 requests/second. A configurable delay between chapter requests (`chapter_delay_ms`) keeps the client within limits. On HTTP `429`, the client honors the server's hint (see "Rate-limit response handling" below) before resuming.
11. **At-home server reporting** — per MangaDex terms of use, the client must report download success/failure back to the API after each chapter (includes `x-cache` header value and download duration). This is mandatory.
12. **Temporary files** — each image and the final CBZ are written to a `.temp` file first, renamed to the final path only on success. Prevents partial/corrupted files if the process is killed mid-download.
13. **`--no-track` flag** — disables history recording for a single run. Useful for one-off downloads the user does not want persisted.

## Rate-limit response handling

> **Historical (pre-ADR-008/009)** — describes the retired MangaDex source and volume mode.

Any MangaDex request (manga search, aggregate, feed, `/at-home/server/:chapterId`, or image fetch) may return `HTTP 429 Too Many Requests`. The client behavior is:

1. Read the wait hint from the response, in priority order:
    - `x-ratelimit-retry-after` (MangaDex-specific, seconds)
    - `Retry-After` (RFC 7231: seconds, or HTTP-date)
    - If neither is present: fall back to an exponential backoff starting at `2 * chapter_delay_ms`, capped at 60 s.
2. Sleep for the hinted duration plus 200 ms jitter.
3. Retry the **same** request, up to 5 attempts. On the 5th attempt failing, propagate the error.
4. While waiting, log at `warn`: `"rate limited by mangadex; sleeping <n>s"`.

A 429 on `/at-home/server/:chapterId` does **not** count as a stale CDN URL — the per-image retry policy (decision #9) only re-fetches `/at-home/server/...` on image-level failures (5xx, network errors), not on rate-limit responses.
