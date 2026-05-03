// Structured logger — see docs/overviewer.md §9.
// Emits to stderr only. User-facing output (tables, prompts, exports) goes to stdout.

import type { LogLevel, Logger, LoggerOptions } from "./types.ts";

export type { Logger, LogFormat, LogLevel, LoggerOptions } from "./types.ts";

const LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2 };

const DENYLIST = new Set(["cookies", "cf_clearance", "useragent", "authorization"]);
const REDACTED = "[REDACTED]";

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = DENYLIST.has(k.toLowerCase()) ? REDACTED : redact(v);
    }
    return out;
  }
  return value;
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = LEVELS[options.level];
  const write = options.write ?? ((line: string) => process.stderr.write(line));
  const now = options.now ?? (() => new Date().toISOString());

  function emit(level: LogLevel, fields: Record<string, unknown>, msg: string): void {
    if (LEVELS[level] > threshold) return;
    const ts = now();
    if (options.format === "json") {
      const safeFields = redact(fields) as Record<string, unknown>;
      const payload = { ts, level, msg, ...safeFields };
      write(`${JSON.stringify(payload)}\n`);
      return;
    }
    write(`${ts} ${level} ${msg}\n`);
  }

  return {
    error: (fields, msg) => emit("error", fields, msg),
    warn: (fields, msg) => emit("warn", fields, msg),
    info: (fields, msg) => emit("info", fields, msg),
  };
}
