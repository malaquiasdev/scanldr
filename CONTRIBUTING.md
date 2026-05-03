# Contributing

## Prerequisites

- [Bun](https://bun.sh) v1.3 or later

## Setup

```bash
git clone https://github.com/malaquiasdev/scanldr.git
cd scanldr
bun install
```

## Before every PR

All three gates must pass:

```bash
bun test && bun run typecheck && bun run check
```

## Project structure

```
src/
├── index.ts            # CLI entrypoint
├── types.ts            # Shared domain types
├── plugins/            # Infrastructure: config/, logger/, db/, errors/, guards/
├── modules/            # Business logic: downloader/, history/, subscriptions/
└── integrations/       # External clients: mangadex/, mangakakalot/
migrations/             # Versioned SQL migrations (applied in lexicographic order)
```

## Conventions

- **No classes** — factory functions with closures (`createX(opts): XClient`)
- **Interfaces in `types.ts`** — never in `index.ts` or `service.ts`
- **Tests colocated** — `src/modules/foo/foo.test.ts`, not `src/__tests__/`
- **Import aliases** — use `@plugins/*`, `@modules/*`, `@integrations/*` for cross-boundary imports; relative imports only within the same folder
- **Logger** — `logger.warn({ event, context, ...fields }, msg)` — fields first, message last; no `debug` level
- **SQL** — queries in `repository.ts`, business logic in `service.ts`

## Pull requests

- Branch from `main`: `git checkout -b feat/<issue-number>-<short-description>`
- Title follows [Conventional Commits](https://www.conventionalcommits.org): `feat(scope): description`
- Fill the PR template — description is required
- Every PR must close an open issue (`Closes #N`)

## Migrations

Add new SQL files under `migrations/` with lexicographic ordering:

```
migrations/
├── 001_create_downloads.sql
├── 002_create_subscriptions.sql
└── 003_your_new_migration.sql
```

Migrations run automatically on CLI boot via `runMigrations(db)`.
