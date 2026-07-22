/**
 * Read-through SQLite cache decorator for search + chapter-list metadata (#164, ADR-006).
 * Wraps a SourceAdapter without changing its observable behavior on a cache miss —
 * the wrapped call and its result are identical, only persisted alongside.
 * fetchChapterInput is never cached: image bytes/pages are explicitly out of scope.
 */

import { createSourceCache, isExpired, normalizeQuery } from "@plugins/source-cache/index.ts";
import type {
  CachedAdapterTtlDays,
  ChapterListing,
  CreateCachedAdapterOptions,
  SearchHit,
  SourceAdapter,
  WrapAdapterWithCacheOptions,
} from "./types.ts";

/** Default 15d TTL for both payload types (2026-07-21 refinement — see issue #164). */
export const DEFAULT_CACHE_TTL_DAYS: CachedAdapterTtlDays = { search: 15, chapterList: 15 };

export function createCachedAdapter(opts: CreateCachedAdapterOptions): SourceAdapter {
  const { adapter, cache, source, logger, forceRefresh = false, now = () => new Date() } = opts;
  const ttlDays: CachedAdapterTtlDays = { ...DEFAULT_CACHE_TTL_DAYS, ...opts.ttlDays };

  async function search(query: string): Promise<SearchHit[]> {
    const key = normalizeQuery(query);
    if (!forceRefresh) {
      const hit = cache.get<SearchHit[]>("search", source, key);
      if (hit && !isExpired(hit.fetchedAt, ttlDays.search, now)) {
        logger.info(
          { event: "source_cache.hit", context: "source-cache", type: "search", source, key },
          "search cache hit, skipping network fetch",
        );
        return hit.payload;
      }
    }
    const results = await adapter.search(query);
    try {
      cache.set("search", source, key, results);
    } catch (err) {
      logger.warn(
        {
          event: "source_cache.write_failed",
          context: "source-cache",
          type: "search",
          source,
          key,
          err,
        },
        "search cache write failed, continuing with fetched results",
      );
    }
    return results;
  }

  async function listChapters(hitId: string): Promise<ChapterListing[]> {
    if (!forceRefresh) {
      const hit = cache.get<ChapterListing[]>("chapter-list", source, hitId);
      if (hit && !isExpired(hit.fetchedAt, ttlDays.chapterList, now)) {
        logger.info(
          {
            event: "source_cache.hit",
            context: "source-cache",
            type: "chapter-list",
            source,
            key: hitId,
          },
          "chapter list cache hit, skipping network fetch",
        );
        return hit.payload;
      }
    }
    const chapters = await adapter.listChapters(hitId);
    try {
      cache.set("chapter-list", source, hitId, chapters);
    } catch (err) {
      logger.warn(
        {
          event: "source_cache.write_failed",
          context: "source-cache",
          type: "chapter-list",
          source,
          key: hitId,
          err,
        },
        "chapter list cache write failed, continuing with fetched results",
      );
    }
    return chapters;
  }

  return { search, listChapters, fetchChapterInput: adapter.fetchChapterInput };
}

/**
 * Wires a SourceAdapter to the SQLite-backed cache using the loaded Config's per-payload
 * TTLs. Returns the adapter unchanged when no `db` is provided (e.g. tests that don't
 * exercise persistence).
 */
export function wrapAdapterWithCache(
  adapter: SourceAdapter,
  opts: WrapAdapterWithCacheOptions,
): SourceAdapter {
  if (!opts.db) return adapter;

  const cache = createSourceCache({ db: opts.db, now: opts.now });
  const ttlDays: CachedAdapterTtlDays = {
    search: opts.config?.search_cache_ttl_days ?? DEFAULT_CACHE_TTL_DAYS.search,
    chapterList: opts.config?.chapter_cache_ttl_days ?? DEFAULT_CACHE_TTL_DAYS.chapterList,
  };

  return createCachedAdapter({
    adapter,
    cache,
    source: opts.source,
    logger: opts.logger,
    ttlDays,
    forceRefresh: opts.forceRefresh,
    now: opts.now,
  });
}
