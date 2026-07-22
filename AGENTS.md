# scanldr — Agent Instructions

Manga chapter downloader CLI (mangakakalot source, one-shot walkthrough).
Full conventions: [docs/conventions.md](docs/conventions.md) — read before writing code.

## Bun-first

This is a **Bun** project.

- Tests: `bun test` / `bun:test` — never jest or vitest.
- `bun run typecheck`, `bun run check` before every PR.
- Prefer Bun-native APIs over `node:*` polyfills when a native exists: `Bun.file`, `bun:sqlite`, `crypto.subtle`, etc.

## Hard rules

- **No classes** — factory functions with closures (`createX(opts): XClient`). Exception: trivial `Error` subclasses (`super(message)` + `this.name` only — `AuthError`, `CliError`, `ConfigError`, `NotImplementedError`).
- **Interfaces/types live only in `types.ts`** — never in `index.ts` or `service.ts`. Re-export via `index.ts`.
- **No flat files in `src/`** — feature-per-folder. Only `index.ts` at root (CLI entrypoint).
- **Import aliases** — `@plugins/*`, `@integrations/*` for cross-boundary imports. Top-level feature folders (`downloader/`, `sources/`, `walkthrough/`) via relative paths.
- `plugins/` = infrastructure, no business rules. `integrations/` = external site clients. `integrations/_shared/` = leaf value/type contracts, no upward imports.

## Anti-patterns (rejected in review)

- ❌ Interface or type declared in `index.ts` or `service.ts` — always `types.ts`.
- ❌ Re-declaring or copy-pasting `AuthSession`, `isValidAuthSession`, or cookie-header serialization — import from the single owner module, don't shadow it.
- ❌ A second implementation of Cloudflare-challenge markers — `integrations/_shared/cloudflare.ts` is the single source of `hasCloudflareChallengeMarkers`; never re-implement it elsewhere.
- ❌ A function > ~50 LOC fusing I/O + business logic + retry — extract a seam. This is what bloated `executeWalkthrough` and fallback-http `dispatch`; don't repeat it.
- ❌ Atomic-write (`.tmp` → rename → unlink-on-fail) copy-pasted across modules — factor to a shared helper.
- ❌ jest/vitest, `node:*` where a Bun-native API exists, or a `class` outside the sanctioned `Error` subclasses.

## Definition of Done

- [ ] Types/interfaces live in `types.ts`, re-exported via `index.ts`.
- [ ] No duplicated auth-session or Cloudflare-marker logic — imported from the single owner.
- [ ] No function > ~50 LOC mixing I/O + business logic + retry.
- [ ] Tests colocated as `*.test.ts` next to the module.
- [ ] Logger calls use the pino-style structured signature (fields first, message last).
- [ ] `bun test && bun run typecheck && bun run check` all green.

## Gates

```bash
bun test && bun run typecheck && bun run check
```
