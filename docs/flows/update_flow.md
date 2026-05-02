# Flow — Update

The `update` command brings a single manga's local archive up to date with the latest published volumes/chapters. It is the building block `sync` invokes for every active subscription.

`update` is functionally a constrained `download`: the volume/chapter range is computed from the diff between MangaDex and the local `downloads` table — the user does not pass `--volume` or `--chapter`. Everything else (history check, image retry, transactional history insert, .temp rename) is identical to `download`.

## Sequence Diagram

```mermaid
sequenceDiagram
    actor User
    participant CLI as scanldr CLI
    participant MDX as MangaDex API
    participant History as downloads (SQLite)
    participant Out as ./download/ (output)

    User->>CLI: scanldr update "witch hat atelier"

    CLI->>MDX: GET /manga?title=... (skip if invoked with manga_id)
    MDX-->>CLI: manga candidates
    CLI->>MDX: GET /manga/:id/aggregate
    MDX-->>CLI: { volumes: { "1": {...}, ..., "12": {...} } }

    CLI->>History: SELECT chapter_id FROM downloads WHERE manga_id = ? AND language = ?
    History-->>CLI: chapter_id[]

    CLI->>CLI: diff (MangaDex chapters) − (history chapters) = missing[]

    alt missing is empty
        CLI-->>User: "Nothing new."
    else missing has chapters
        Note over CLI: language resolution (see below) before any image fetch
        loop for each missing chapter, grouped by volume
            CLI->>MDX: GET /at-home/server/:chapterId
            MDX-->>CLI: image server + page list
            loop images in parallel (image_concurrency)
                CLI->>MDX: GET image
                MDX-->>CLI: image bytes
            end
        end
        CLI->>Out: write/update <slug>-volume-<nnn>.cbz (rename .temp → final)
        CLI->>History: BEGIN; INSERT (one row per chapter); COMMIT
        CLI-->>User: "Downloaded N chapters across M volumes."
    end
```

## Language Resolution

`update` runs in two contexts: interactive (user typed `scanldr update X`) and non-interactive (`sync` → `update` under cron, no TTY). The resolution rule is the same in both, only the fallback differs:

1. Read `preferred_languages` from `scanldr.json` (e.g. `["en", "pt-BR"]`).
2. Walk the list in priority order. The first language that has chapters available on MangaDex (for the missing chapters) wins. Use it silently — no prompt.
3. If none of the preferred languages match:
    - **TTY present** (`process.stdout.isTTY === true`): show a picker with all available languages and wait for the user's choice.
    - **No TTY** (cron, CI, redirected stdout): log `"<title>: no preferred language available (had: <list>)"` and exit the entry as **skipped**. Do not block, do not pick arbitrarily.

`update`'s exit code:

| Outcome | Exit code |
|---|---|
| Downloaded one or more chapters | `0` |
| Nothing new | `0` |
| Skipped (no preferred language under no-TTY) | `0` by default, `2` if `--strict` |
| Network / parse / auth error | `1` |

`sync` aggregates these per entry. `sync --strict` exits non-zero if any entry was skipped or errored — useful for cron alerting.

## Decisions

1. **No interactive volume picker** — `update` always considers every missing chapter. If the user wants partial control, they use `download --volume <range>` instead.
2. **Fallback site is not auto-attempted on `update`** — if the title is not on MangaDex, `update` exits with an error. The user must explicitly run `download` with the fallback path. Reasoning: silent fallback during cron would change the recorded `source` for a series mid-stream, polluting history.
3. **Language lock per run, not per chapter** — once resolved, every chapter in this run is downloaded in that language. Mixing languages across chapters would yield CBZ files that read inconsistently.
4. **`--strict` is sync-friendly, not the default** — most users want best-effort sync without alarms. Cron users add `--strict` to surface skips/failures.
5. **TTY detection over an explicit `--non-interactive`** — one less flag for users to remember; cron pipelines naturally have no TTY.
6. **`--force` honored** — re-downloads even chapters present in history, useful when a chapter was scanlated again with better quality.
