// Internal types and domain errors for the mangakakalot client.
// Public re-exports (ChapterRef, MangaCandidate, ImageRef, MangakakalotClient) live in index.ts.

import type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
import type { ImageRef } from "@integrations/_shared/media.ts";
import type { FallbackHttpClient } from "@integrations/fallback-http/types.ts";
import type { Logger } from "@plugins/logger/index.ts";

/** A chapter reference on the fallback site (used for chapter labeling). */
export interface FallbackChapterRef {
  /** Chapter number string (e.g. "128", "1.5"). Null when not parseable. */
  chapter: string | null;
  /** Composite id "<mangaSlug>/<chapter-slug>" matching getChapterImages() convention. */
  id: string;
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface CreateClientOptions {
  http: FallbackHttpClient;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// JSON API shapes (chapter list endpoint)
// ---------------------------------------------------------------------------

export interface MkChapterApiItem {
  chapter_name: string;
  chapter_slug: string;
  chapter_num: number;
  updated_at: string;
  view: number;
}

export interface MkChapterApiPagination {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface MkChapterApiResponse {
  success: boolean;
  data: { chapters: MkChapterApiItem[]; pagination?: MkChapterApiPagination };
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class MangakakalotParseError extends Error {
  override readonly name = "MangakakalotParseError";
  constructor(
    public readonly selector: string,
    public readonly url: string,
    message: string,
  ) {
    super(`[mangakakalot] parse failed at selector "${selector}" on ${url}: ${message}`);
  }
}

export interface MangakakalotClient {
  searchManga(title: string): Promise<MangaCandidate[]>;
  getChapterList(slug: string): Promise<ChapterRef[]>;
  getChapterImages(chapterIdOrUrl: string): Promise<ImageRef[]>;
}
