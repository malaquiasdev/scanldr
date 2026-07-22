// Source-cache plugin types.

import type { Database } from "bun:sqlite";

/** Which walkthrough payload the row holds — search hits vs. chapter listings. */
export type CachePayloadType = "search" | "chapter-list";

export interface SourceCacheRow {
  source: string;
  payload_type: CachePayloadType;
  key: string;
  payload_json: string;
  fetched_at: string;
}

export interface SourceCacheHit<T> {
  payload: T;
  fetchedAt: Date;
}

export interface SourceCacheStore {
  get<T>(payloadType: CachePayloadType, source: string, key: string): SourceCacheHit<T> | null;
  set<T>(payloadType: CachePayloadType, source: string, key: string, payload: T): void;
}

export interface CreateSourceCacheOptions {
  /** An already-open Database instance. The store will NOT close it. */
  db: Database;
  /** Clock injection for deterministic TTL tests. Defaults to real Date. */
  now?: () => Date;
}
