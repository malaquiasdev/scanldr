# Logging

The logger has two sinks:

- **Terminal** — human-readable output (`${ts} ${level} ${msg}\n`). This is the default.
- **Trace store** — structured rows written to the `traces` table in SQLite, with 3-day TTL; `cookies`, `cf_clearance`, `useragent`, and `authorization` fields are redacted to `[REDACTED]` before being written.

## CLI flags

```bash
bun start          # human-readable terminal output (default)
bun start --json   # JSON output to stderr (for log shippers)
bun start --human  # no-op alias for back-compat
bun start -q       # suppress info logs (warn + error only)
```

## Trace store

The trace store is located at `<db_path>` (default: `~/.local/share/scanldr/scanldr.db`), table `traces`. Each run gets a unique `run_id` (UUID v4) for filtering.
