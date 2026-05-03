# Code Conventions

## Project Structure

```
src/
├── index.ts            # CLI entrypoint
├── types.ts            # Shared domain types
├── plugins/            # Infrastructure: config/, logger/, db/, errors/, guards/
├── modules/            # Business logic: downloader/, history/, subscriptions/
└── integrations/       # External clients: mangadex/, mangakakalot/
migrations/             # Versioned SQL migrations (applied in lexicographic order)
```

Each folder has `index.ts` (public API), `types.ts` (interfaces), `service.ts` or `repository.ts` as needed, and `<name>.test.ts` colocated — never in a top-level `__tests__/` directory.

## Hard Rules

- **No classes** — factory functions with closures only (`createX(opts): XClient`). State lives in the closure.
- **Interfaces in `types.ts`** — never declare interfaces or types in `index.ts` or `service.ts`. Re-export from `index.ts`.
- **No flat files in `src/`** — every feature in its own folder. Only `index.ts` and `types.ts` at root level.
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
