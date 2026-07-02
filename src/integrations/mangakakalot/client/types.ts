// Internal types and domain errors for the mangakakalot client.
// Public re-exports (ChapterRef, MangaCandidate, ImageRef, MangakakalotClient) live in index.ts.

import type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
import type { ImageRef } from "@integrations/_shared/media.ts";

// ---------------------------------------------------------------------------
// Volume mapping (manga page HTML)
// ---------------------------------------------------------------------------

/** A chapter reference on the fallback site with enough info for volume-based selection. */
export interface FallbackChapterRef {
  /** Chapter number string (e.g. "128", "1.5"). Null when not parseable. */
  chapter: string | null;
  /** Composite id "<mangaSlug>/<chapter-slug>" matching getChapterImages() convention. */
  id: string;
}

/** One volume bucket extracted from the manga page. */
export interface VolumeBucket {
  /** Volume number as a string (e.g. "13"). "unknown" for flat/unlabelled chapters. */
  volume: string;
  chapters: FallbackChapterRef[];
}

/**
 * Volume-to-chapter mapping parsed from the fallback site manga page.
 * Empty array means the page had no chapter list at all (DOM drift).
 */
export type VolumeMap = VolumeBucket[];

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
  /** Fetch the manga detail page and parse volume→chapter mapping from the HTML. */
  getVolumeMap(slug: string): Promise<VolumeMap>;
}
