import type {
  CachePayloadType,
  CreateSourceCacheOptions,
  SourceCacheHit,
  SourceCacheRow,
  SourceCacheStore,
} from "./types.ts";

export type {
  CachePayloadType,
  CreateSourceCacheOptions,
  SourceCacheHit,
  SourceCacheStore,
} from "./types.ts";

/**
 * Source cache — persists search results + chapter lists to SQLite (ADR-006 precedent:
 * TTL'd SQLite state, same table shape as the trace store).
 * TTL expiry is NOT enforced here — callers compare `fetchedAt` against their own TTL
 * (see `isExpired`) so per-payload-type TTLs stay a caller concern, not a store concern.
 */
export function createSourceCache(opts: CreateSourceCacheOptions): SourceCacheStore {
  const { db, now = () => new Date() } = opts;

  const selectStmt = db.prepare<SourceCacheRow, [string, string, string]>(
    "SELECT source, payload_type, key, payload_json, fetched_at FROM source_cache WHERE source = ? AND payload_type = ? AND key = ?",
  );

  const upsertStmt = db.prepare<
    void,
    [string, string, string, string, string]
  >(`INSERT INTO source_cache (source, payload_type, key, payload_json, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source, payload_type, key) DO UPDATE SET
       payload_json = excluded.payload_json,
       fetched_at = excluded.fetched_at`);

  function get<T>(
    payloadType: CachePayloadType,
    source: string,
    key: string,
  ): SourceCacheHit<T> | null {
    const row = selectStmt.get(source, payloadType, key);
    if (!row) return null;
    try {
      return { payload: JSON.parse(row.payload_json) as T, fetchedAt: new Date(row.fetched_at) };
    } catch {
      return null;
    }
  }

  function set<T>(payloadType: CachePayloadType, source: string, key: string, payload: T): void {
    upsertStmt.run(source, payloadType, key, JSON.stringify(payload), now().toISOString());
  }

  return { get, set };
}

/** True when `fetchedAt` is older than `ttlDays`. Clock is injectable for deterministic tests. */
export function isExpired(
  fetchedAt: Date,
  ttlDays: number,
  now: () => Date = () => new Date(),
): boolean {
  const ageMs = now().getTime() - fetchedAt.getTime();
  return ageMs > ttlDays * 24 * 60 * 60 * 1000;
}

/** Normalizes a search query into a stable cache key (trim, lowercase, collapse whitespace). */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}
