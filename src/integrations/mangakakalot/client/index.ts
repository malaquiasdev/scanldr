// Mangakakalot site client.
// Wraps a FallbackHttpClient (cookie-replay, handles Cloudflare) and returns parsed domain types.
// Callers are responsible for creating the FallbackHttpClient via createFallbackHttp().

import type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
import type { FallbackHttpClient } from "@integrations/fallback-http/types.ts";
import type { ImageRef } from "@modules/downloader/types.ts";
import type { Logger } from "@plugins/logger/index.ts";
import {
  detectChapterApiPlaceholder,
  parseChapterImages,
  parseChapterListFromApi,
  parseSearchResults,
} from "./parser.ts";
import type { MangakakalotClient, VolumeMap } from "./types.ts";
import { MangakakalotParseError } from "./types.ts";
import { chaptersToVolumeMap, parseVolumeMapping } from "./volume-parser.ts";

export type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
export type { ImageRef } from "@modules/downloader/types.ts";
export type { FallbackChapterRef, MangakakalotClient, VolumeBucket, VolumeMap } from "./types.ts";
export { MangakakalotParseError } from "./types.ts";

const SITE_ROOT = "https://www.mangakakalot.gg";
const SEARCH_URL = `${SITE_ROOT}/search/story`;
const CHAPTERS_API_URL = (slug: string, offset = 0) =>
  `${SITE_ROOT}/api/manga/${encodeURIComponent(slug)}/chapters?offset=${offset}`;

/** Guard against runaway pagination (e.g. malformed has_more loop). */
const MAX_API_PAGES = 20;

export function createMangakakalotClient(opts: {
  http: FallbackHttpClient;
  logger: Logger;
}): MangakakalotClient {
  const { http, logger } = opts;

  async function fetchHtml(url: string, extraHeaders?: Record<string, string>): Promise<string> {
    logger.info({ event: "mangakakalot.fetch", context: "mangakakalot", url }, "fetching page");
    const res = await http.get(url, extraHeaders);
    return res.text();
  }

  /** Runs a parser function and wraps MangakakalotParseError with a warn log before re-throwing. */
  function runParser<T>(url: string, fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof MangakakalotParseError) {
        logger.warn(
          {
            event: "mangakakalot.parse_failed",
            context: "mangakakalot",
            url,
            selector: err.selector,
            err,
          },
          "mangakakalot DOM parse failed",
        );
      }
      throw err;
    }
  }

  async function searchManga(title: string): Promise<MangaCandidate[]> {
    // URL: https://www.mangakakalot.gg/search/story/<encoded-title>
    // Words separated by underscores per mangakakalot's search convention.
    const encoded = encodeURIComponent(title.toLowerCase().replace(/\s+/g, "_"));
    const url = `${SEARCH_URL}/${encoded}`;
    const html = await fetchHtml(url);
    return runParser(url, () => parseSearchResults(html, url));
  }

  async function getChapterList(slug: string): Promise<ChapterRef[]> {
    let allChapters: ChapterRef[] = [];
    let offset = 0;
    let pagesLoaded = 0;

    while (pagesLoaded < MAX_API_PAGES) {
      const apiUrl = CHAPTERS_API_URL(slug, offset);
      logger.info(
        { event: "mangakakalot.fetch", context: "mangakakalot", url: apiUrl },
        "fetching chapter list from API",
      );
      const res = await http.get(apiUrl, { accept: "application/json" });
      if (!res.ok) {
        logger.warn(
          {
            event: "mangakakalot.chapters_api_error",
            context: "mangakakalot",
            slug,
            status: res.status,
          },
          `chapters API returned HTTP ${res.status}`,
        );
        throw new MangakakalotParseError(
          "data.chapters",
          apiUrl,
          `chapters API returned HTTP ${res.status}`,
        );
      }
      const json: unknown = await res.json();
      const { chapters, hasMore, limit } = runParser(apiUrl, () =>
        parseChapterListFromApi(json, slug),
      );
      allChapters = allChapters.concat(chapters);
      pagesLoaded++;

      if (!hasMore) break;

      offset += limit;
    }

    if (pagesLoaded >= MAX_API_PAGES) {
      logger.warn(
        {
          event: "mangakakalot.pagination_capped",
          context: "mangakakalot",
          slug,
          cap: MAX_API_PAGES,
        },
        "API pagination cap reached; chapter list may be incomplete",
      );
    }

    // Final sort — pages come back newest-first but each page is sorted ascending;
    // concat order may produce a mis-sorted result across page boundaries.
    allChapters.sort((a, b) => Number(a.chapter) - Number(b.chapter));

    return allChapters;
  }

  async function getVolumeMap(slug: string): Promise<VolumeMap> {
    const url = `${SITE_ROOT}/manga/${encodeURIComponent(slug)}`;
    const html = await fetchHtml(url);

    // Route 1: if HTML embeds the chapter-list-container API placeholder,
    // fetch via API and map to VolumeMap. This is the path Naruto takes today.
    const placeholder = detectChapterApiPlaceholder(html);
    if (placeholder) {
      logger.info(
        {
          event: "mangakakalot.api_placeholder_detected",
          context: "mangakakalot",
          slug,
          placeholderSlug: placeholder.slug,
        },
        "manga page uses client-side API placeholder; fetching chapter list from API",
      );
      const chapters = await getChapterList(placeholder.slug);
      return chaptersToVolumeMap(chapters);
    }

    // Route 2: inline chapter list (current path for dandadan/jjk/etc).
    // Drift detector still fires when neither inline list nor API placeholder is present.
    return runParser(url, () => parseVolumeMapping(html, url));
  }

  async function getChapterImages(chapterIdOrUrl: string): Promise<ImageRef[]> {
    // Accept a full URL, a composite id "mangaSlug/chapter-slug" (from parseChapterListFromApi),
    // or the legacy path-style id "chapter/manga-slug/chapter-1".
    let url: string;
    if (chapterIdOrUrl.startsWith("http://") || chapterIdOrUrl.startsWith("https://")) {
      url = chapterIdOrUrl;
    } else {
      // Composite id from JSON API: "<mangaSlug>/<chapter-slug>" → /manga/<mangaSlug>/<chapter-slug>
      // Legacy path-style: "chapter/..." → /<path>  (kept for backward compat)
      const isLegacyChapterPath = chapterIdOrUrl.startsWith("chapter/");
      url = isLegacyChapterPath
        ? `${SITE_ROOT}/${chapterIdOrUrl}`
        : `${SITE_ROOT}/manga/${chapterIdOrUrl}`;
    }
    const html = await fetchHtml(url);
    return runParser(url, () => parseChapterImages(html, url));
  }

  return { searchManga, getChapterList, getChapterImages, getVolumeMap };
}
