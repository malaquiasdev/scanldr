// Structured logger — see docs/overviewer.md §9.
// Emits to stderr only. User-facing output (tables, prompts, exports) goes to stdout.

export type LogLevel = "error" | "warn" | "info" | "debug";
export type LogFormat = "human" | "json";

export interface LoggerOptions {
  level: LogLevel;
  format: LogFormat;
  /** Optional sink — defaults to process.stderr. Used for tests. */
  write?: (line: string) => void;
  /** Optional clock — defaults to () => new Date().toISOString(). Used for tests. */
  now?: () => string;
}

export interface Logger {
  error: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  debug: (msg: string, fields?: Record<string, unknown>) => void;
}

const LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

// Lower-cased denylist — see docs/overviewer.md §9.
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

  function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVELS[level] > threshold) return;
    const ts = now();
    if (options.format === "json") {
      const safeFields = fields ? (redact(fields) as Record<string, unknown>) : undefined;
      const payload = { ts, level, msg, ...(safeFields ?? {}) };
      write(`${JSON.stringify(payload)}\n`);
      return;
    }
    write(`${ts} ${level} ${msg}\n`);
  }

  return {
    error: (msg, fields) => emit("error", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    debug: (msg, fields) => emit("debug", msg, fields),
  };
}
