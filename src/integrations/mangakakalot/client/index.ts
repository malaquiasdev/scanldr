// Mangakakalot site client.
// Wraps a FallbackHttpClient (cookie-replay, handles Cloudflare) and returns parsed domain types.
// Callers are responsible for creating the FallbackHttpClient via createFallbackHttp().

import type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
import type { FallbackHttpClient } from "@integrations/fallback-http/types.ts";
import type { ImageRef } from "@modules/downloader/types.ts";
import type { Logger } from "@plugins/logger/index.ts";
import { parseChapterImages, parseChapterListFromApi, parseSearchResults } from "./parser.ts";
import type { MangakakalotClient } from "./types.ts";
import { MangakakalotParseError } from "./types.ts";

export type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
export type { ImageRef } from "@modules/downloader/types.ts";
export type { MangakakalotClient } from "./types.ts";
export { MangakakalotParseError } from "./types.ts";

const SITE_ROOT = "https://www.mangakakalot.gg";
const SEARCH_URL = `${SITE_ROOT}/search/story`;
const CHAPTERS_API_URL = (slug: string) =>
  `${SITE_ROOT}/api/manga/${encodeURIComponent(slug)}/chapters`;

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
    const apiUrl = CHAPTERS_API_URL(slug);
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
    return runParser(apiUrl, () => parseChapterListFromApi(json, slug));
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

  return { searchManga, getChapterList, getChapterImages };
}
