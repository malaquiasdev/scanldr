import type { Database } from "bun:sqlite";

export interface TraceRow {
  ts: string;
  level: string;
  event?: string;
  msg: string;
  fields_json?: string;
  run_id?: string;
}

export interface TraceStore {
  insert(row: TraceRow): void;
  purge(maxAgeDays: number): void;
  /** No-op: the store does not own the db connection; caller manages its lifecycle. */
  close(): void;
  runId: string;
}

export interface CreateTraceStoreOpts {
  /** An already-open Database instance. The store will NOT close it. */
  db: Database;
}
