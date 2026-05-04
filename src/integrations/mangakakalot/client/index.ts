// Mangakakalot site client.
// Wraps a FallbackHttpClient (cookie-replay, handles Cloudflare) and returns parsed domain types.
// Callers are responsible for creating the FallbackHttpClient via createFallbackHttp().

import type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
import type { FallbackHttpClient } from "@integrations/fallback-http/types.ts";
import type { ImageRef } from "@modules/downloader/types.ts";
import type { Logger } from "@plugins/logger/index.ts";
import {
  parseChapterImages,
  parseChapterList,
  parseChapterListPagination,
  parseSearchResults,
} from "./parser.ts";

export type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
export type { ImageRef } from "@modules/downloader/types.ts";
export { MangakakalotParseError } from "./types.ts";

const SITE_ROOT = "https://mangakakalot.gg";
const SEARCH_URL = `${SITE_ROOT}/search/story`;
const MANGA_URL = (slug: string) => `${SITE_ROOT}/manga/${slug}`;

/** Maximum pages to follow when paginating a chapter list — guards against misparsed links. */
const MAX_PAGINATION_PAGES = 20;

export interface MangakakalotClient {
  searchManga(title: string): Promise<MangaCandidate[]>;
  getChapterList(slug: string): Promise<ChapterRef[]>;
  getChapterImages(chapterIdOrUrl: string): Promise<ImageRef[]>;
}

export function createMangakakalotClient(opts: {
  http: FallbackHttpClient;
  logger: Logger;
}): MangakakalotClient {
  const { http, logger } = opts;

  async function fetchHtml(url: string): Promise<string> {
    logger.info({ event: "mangakakalot.fetch", context: "mangakakalot", url }, "fetching page");
    const res = await http.get(url);
    return res.text();
  }

  async function searchManga(title: string): Promise<MangaCandidate[]> {
    // URL: https://mangakakalot.gg/search/story/<encoded-title>
    // Words separated by underscores per mangakakalot's search convention.
    const encoded = encodeURIComponent(title.toLowerCase().replace(/\s+/g, "_"));
    const url = `${SEARCH_URL}/${encoded}`;
    const html = await fetchHtml(url);
    return parseSearchResults(html);
  }

  async function getChapterList(slug: string): Promise<ChapterRef[]> {
    let url: string | null = MANGA_URL(slug);
    let allChapters: ChapterRef[] = [];
    let pagesFollowed = 0;

    while (url !== null && pagesFollowed < MAX_PAGINATION_PAGES) {
      const html = await fetchHtml(url);
      const pageChapters = parseChapterList(html, slug);
      allChapters = allChapters.concat(pageChapters);

      const nextUrl = parseChapterListPagination(html);
      url = nextUrl;
      pagesFollowed++;
    }

    return allChapters;
  }

  async function getChapterImages(chapterIdOrUrl: string): Promise<ImageRef[]> {
    // Accept either a full URL or a path-style id like "chapter/manga-slug/chapter-1".
    let url: string;
    if (chapterIdOrUrl.startsWith("http://") || chapterIdOrUrl.startsWith("https://")) {
      url = chapterIdOrUrl;
    } else {
      url = `${SITE_ROOT}/${chapterIdOrUrl}`;
    }
    const html = await fetchHtml(url);
    return parseChapterImages(html);
  }

  return { searchManga, getChapterList, getChapterImages };
}
