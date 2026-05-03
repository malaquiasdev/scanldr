# scanldr — Conventions for Claude Agents

## Project Structure

```
src/
├── index.ts              # CLI entrypoint — parseArgs, dispatch to commands
├── types.ts              # Shared domain types used across multiple modules
├── plugins/              # Cross-cutting infrastructure (config, logger, errors, guards)
│   ├── config/
│   │   ├── index.ts      # Logic only — loadConfig(), validateAndMerge(), DEFAULT_CONFIG
│   │   └── types.ts      # Interfaces — Config, LoadConfigOptions, LoadConfigResult
│   ├── logger/
│   │   ├── index.ts      # Logic only — createLogger()
│   │   └── types.ts      # Interfaces — Logger, LoggerOptions, LogLevel, LogFormat
│   ├── errors/
│   │   └── index.ts      # Error classes — ConfigError, etc.
│   └── guards/
│       └── index.ts      # Generic predicates — check(), isPlainObject()
├── modules/              # Business logic (downloader, history, subscriptions)
│   └── <name>/
│       ├── index.ts      # Public API of the module
│       ├── service.ts    # Business logic
│       └── types.ts      # Interfaces and types local to this module
└── integrations/         # External site clients
    └── <name>/
        ├── index.ts      # Public API
        └── types.ts      # Interfaces and types local to this integration
```

## Hard Rules

### Interfaces always in `types.ts`
**Never** declare interfaces or type aliases in the same file as logic (`index.ts`, `service.ts`).
Every plugin, module, and integration that has interfaces must have a `types.ts` alongside.

```
# WRONG — interface in index.ts
src/plugins/logger/index.ts  ← export interface Logger { ... }  ❌

# CORRECT
src/plugins/logger/types.ts  ← export interface Logger { ... }  ✅
src/plugins/logger/index.ts  ← import type { Logger } from "./types.ts"; logic only ✅
```

Re-export types from `index.ts` so consumers import from one place:
```ts
// index.ts
export type { Logger, LoggerOptions } from "./types.ts";
```

### `plugins/` vs `modules/` vs `integrations/`
- `plugins/` — infrastructure with no business rules (config loader, logger, error classes, utility predicates)
- `modules/` — business domain (downloader, history, subscriptions)
- `integrations/` — external site clients (mangadex, mangakakalot)

### No flat files in `src/`
Every new feature lives in its own folder. The only flat files allowed at `src/` root are `index.ts` and `types.ts` (shared domain types).

### Import aliases
Use aliases for cross-boundary imports:
- `@plugins/*` → `src/plugins/*`
- `@modules/*` → `src/modules/*`
- `@integrations/*` → `src/integrations/*`

Relative imports (`./types.ts`, `./service.ts`) are only allowed within the same plugin/module/integration folder.