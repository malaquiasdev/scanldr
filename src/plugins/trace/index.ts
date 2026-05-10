// Trace store — persists structured log rows to SQLite with TTL purge.
// Each store instance tracks a single run_id (UUID v4) for the lifetime of the process.

import { redact } from "@plugins/logger/redact.ts";
import type { CreateTraceStoreOpts, TraceRow, TraceStore } from "./types.ts";

export type { CreateTraceStoreOpts, TraceRow, TraceStore } from "./types.ts";

export function createTraceStore(opts: CreateTraceStoreOpts): TraceStore {
  const { db } = opts;
  const runId = crypto.randomUUID();

  // Purge stale rows eagerly on instantiation (3-day default).
  purge(3);

  const insertStmt = db.prepare<
    void,
    [string, string, string | null, string, string | null, string]
  >("INSERT INTO traces (ts, level, event, msg, fields_json, run_id) VALUES (?, ?, ?, ?, ?, ?)");

  function purge(maxAgeDays: number): void {
    db.exec(`DELETE FROM traces WHERE ts < datetime('now', '-${maxAgeDays} days')`);
  }

  function insert(row: TraceRow): void {
    let safeFieldsJson: string | null = null;
    if (row.fields_json) {
      try {
        const parsed = JSON.parse(row.fields_json);
        safeFieldsJson = JSON.stringify(redact(parsed));
      } catch {
        safeFieldsJson = row.fields_json;
      }
    }

    insertStmt.run(
      row.ts,
      row.level,
      row.event ?? null,
      row.msg,
      safeFieldsJson,
      row.run_id ?? runId,
    );
  }

  function close(): void {
    // Store does not own the db; caller manages connection lifecycle.
  }

  return { insert, purge, close, runId };
}
