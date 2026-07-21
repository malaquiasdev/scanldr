// Structured logger — see docs/overviewer.md §9.
// Emits to stderr only. User-facing output (tables, prompts, exports) goes to stdout.

import type { TraceStore } from "@plugins/trace/index.ts";
import { redact } from "./redact.ts";
import type { Logger, LoggerOptions, LogLevel } from "./types.ts";

export { redact } from "./redact.ts";
export type { LogFormat, Logger, LoggerOptions, LogLevel } from "./types.ts";

const LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2 };

export function createLogger(options: LoggerOptions, traceStore?: TraceStore): Logger {
  const threshold = LEVELS[options.level];
  const write = options.write ?? ((line: string) => process.stderr.write(line));
  const now = options.now ?? (() => new Date().toISOString());

  /**
   * Emits logs in either JSON or human format. In human format, plain line without fields suffix — fields are captured in trace store only.
   */
  function emit(level: LogLevel, fields: Record<string, unknown>, msg: string): void {
    if (LEVELS[level] > threshold) return;
    const ts = now();
    const safeFields = redact(fields) as Record<string, unknown>;

    if (traceStore) {
      const fieldsJson =
        Object.keys(safeFields).length > 0 ? JSON.stringify(safeFields) : undefined;
      const event = typeof fields.event === "string" ? fields.event : undefined;
      traceStore.insert({ ts, level, event, msg, fields_json: fieldsJson });
    }

    if (options.format === "json") {
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
