// Source adapter interface — boundary between walkthrough and integration clients.
// Each adapter wraps an integration client and maps it to walkthrough DTOs.

import type { ChapterInput } from "@integrations/_shared/media.ts";
import type { FallbackHttpClient } from "@integrations/fallback-http/index.ts";
import type { MangakakalotClient } from "@integrations/mangakakalot/client/index.ts";
import type { Config } from "@plugins/config/index.ts";
import type { Db } from "@plugins/db/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import type { SourceCacheStore } from "@plugins/source-cache/index.ts";
import type { ChapterListing, SearchHit } from "../../walkthrough/types.ts";

export type { ChapterListing, SearchHit };

export interface GetAdapterOptions {
  logger: Logger;
  /** User config — unused by the sole remaining (mangakakalot) adapter, kept for API stability. */
  config?: Config;
}

export interface CachedAdapterTtlDays {
  search: number;
  chapterList: number;
}

export interface CreateCachedAdapterOptions {
  adapter: SourceAdapter;
  cache: SourceCacheStore;
  source: string;
  logger: Logger;
  ttlDays?: Partial<CachedAdapterTtlDays>;
  /** Bypasses cache reads; the fresh result still overwrites the cache. */
  forceRefresh?: boolean;
  /** Clock injection for deterministic TTL tests. */
  now?: () => Date;
}

export interface WrapAdapterWithCacheOptions {
  db?: Db;
  config?: Config;
  source: string;
  logger: Logger;
  forceRefresh?: boolean;
  now?: () => Date;
}

export interface MangakakalotAdapterOptions {
  logger: Logger;
  /** Injected client — used in tests. Production omits this and builds the real one. */
  client?: MangakakalotClient;
  /** Injected HTTP client — used in tests. Production omits this. */
  http?: FallbackHttpClient;
}

export interface SourceAdapter {
  search(query: string): Promise<SearchHit[]>;
  /** List chapters for the given hit id. */
  listChapters(hitId: string): Promise<ChapterListing[]>;
  /**
   * Resolve a chapter id (from listChapters) to a ChapterInput
   * ready for the downloader service.
   * @param chapterNum optional chapter number string (e.g. "103.5") — used to populate ChapterInput.num.
   */
  fetchChapterInput(chapterId: string, chapterNum?: string): Promise<ChapterInput>;
}
