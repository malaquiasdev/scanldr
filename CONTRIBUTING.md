# Contributing

## Prerequisites

- [Bun](https://bun.sh) v1.3 or later

## Setup

```bash
git clone https://github.com/malaquiasdev/scanldr.git
cd scanldr
bun install
```

## Code conventions

See **[docs/conventions.md](docs/conventions.md)** for the full reference: project structure, coding rules, logger signature, SQL pattern, and test conventions.

## Pull requests

- Branch from `main`: `git checkout -b feat/<issue-number>-<short-description>`
- Title follows [Conventional Commits](https://www.conventionalcommits.org): `feat(scope): description`
- Fill the PR template — description is required
- Every PR must close an open issue (`Closes #N`)
- All gates must pass before merge: `bun test && bun run typecheck && bun run check`
