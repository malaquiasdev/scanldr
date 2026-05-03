# scanldr — Agent Instructions

## Conventions

All code conventions (project structure, no classes, interfaces in types.ts, colocated tests, logger signature, SQL pattern, migrations) are documented in:

**[docs/conventions.md](docs/conventions.md)**

Read it before writing any code.

## Gates before every PR

```bash
bun test && bun run typecheck && bun run check
```

## Reference Project

`/Users/mateusmalaquias/Developer/me/faturamento/src`
