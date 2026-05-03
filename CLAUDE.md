# scanldr — Conventions for Claude Agents

## Project Structure

```
src/
├── index.ts         # CLI entrypoint
├── types.ts         # Shared domain types
├── plugins/         # Infrastructure: config/, logger/, errors/, guards/
├── modules/         # Business logic: downloader/, history/, subscriptions/
└── integrations/    # External clients: mangadex/, mangakakalot/
```

Each folder has `index.ts` (public API / logic), `types.ts` (interfaces), and `service.ts` or `repository.ts` as needed.

## Hard Rules

- **Interfaces in `types.ts`** — never declare interfaces in `index.ts` or `service.ts`. Re-export from `index.ts`.
- **No classes** — factory functions only. State lives in closures (`createX(opts): XClient`).
- **No flat files in `src/`** — every feature in its own folder. Only `index.ts` and `types.ts` at root.
- **Import aliases** — cross-boundary imports use `@plugins/*`, `@modules/*`, `@integrations/*`. Relative imports only within the same folder.
- **`plugins/`** = infrastructure (no business rules). **`modules/`** = business domain. **`integrations/`** = external site clients.

## Gates before every PR

```bash
bun test && bun run typecheck && bun run check
```

## Reference Project

`/Users/mateusmalaquias/Developer/me/faturamento/src`
