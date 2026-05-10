# Code Conventions

## Project Structure

```
src/
├── index.ts            # CLI entrypoint — trace store + logger init → runWalkthrough
├── walkthrough/        # Orchestrates the 9-step one-shot download walkthrough
├── sources/            # Source adapter layer (mangadex, mangakakalot wrappers)
├── pack/               # CBZ/ZIP packaging primitives
├── plugins/            # Infrastructure: config/, logger/, db/, errors/, guards/, trace/
├── modules/            # Business logic: downloader/
└── integrations/       # External site clients: mangadex/, mangakakalot/
migrations/             # Versioned SQL migrations (applied in lexicographic order)
```

Each folder has `index.ts` (public API), `types.ts` (interfaces), `service.ts` or `repository.ts` as needed, and `<name>.test.ts` colocated — never in a top-level `__tests__/` directory.

### Allowed extra filenames inside a feature folder

A feature folder may also contain narrowly-scoped helpers when their concern doesn't fit `service.ts` or `repository.ts`:

- **`helpers.ts`** — pure utility functions used only inside the feature (e.g. `pad`, `detectExtFromBytes` in `modules/downloader/`).
- **`semaphore.ts`**, **`bucket.ts`**, **`util.ts`**, etc. — single-responsibility helpers named after the primitive they implement. Keep them small and feature-internal; promote to a plugin only if they end up imported across boundaries.

These files still follow all other rules: no classes, types live in the feature's `types.ts`, public surface is re-exported from `index.ts` only when needed.

## Hard Rules

- **No classes** — factory functions with closures only (`createX(opts): XClient`). State lives in the closure.
  - **Exception:** `Error` subclasses are allowed when a domain needs a typed exception that callers branch on with `instanceof` (`AuthError`, `CliError`, `ConfigError`, `NotImplementedError`). Keep the body trivial — just `super(message)` and `this.name = "..."`.
- **Interfaces in `types.ts`** — never declare interfaces or types in `index.ts` or `service.ts`. Re-export from `index.ts`.
- **No flat files in `src/`** — every feature in its own folder. Only `index.ts` at root level (the CLI entrypoint).
- **Import aliases** — cross-boundary imports use `@plugins/*`, `@modules/*`, `@integrations/*`. Relative imports only within the same folder.
- **`plugins/`** = infrastructure (no business rules). **`modules/`** = business domain. **`integrations/`** = external site clients.

## Logger

Signature follows the pino convention — structured fields first, human message last:

```ts
logger.info({ event: "downloader.chapter_start", context: "downloader", id, num }, "downloading chapter")
logger.warn({ event: "mangadex.rate_limited", context: "http", attempt, waitMs }, "429 rate-limited, backing off")
logger.error({ event: "cli.boot_failed", context: "main", err }, "failed to open database")
```

- `error` — unhandled failure, operation aborted
- `warn` — handled failure, operation continued (retry, backoff, fallback)
- `info` — normal progress, one line per stage
- No `debug` level

## SQL

- Queries live in `repository.ts` — pure SQL, no business logic
- Business rules live in `service.ts` — calls repository, no raw SQL
- Schema changes go in `migrations/` as numbered `.sql` files (`001_`, `002_`, ...)
- Migrations run automatically on CLI boot via `runMigrations(db)` from `@plugins/db`

## Tests

- Colocated with the module: `src/modules/foo/foo.test.ts`
- Use `bun:test` — no external test framework
- Integration tests hit a real SQLite database — no mocks for DB

## Gates

Every PR must pass before merge:

```bash
bun test && bun run typecheck && bun run check
```
