import type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
import type { ImageRef } from "@integrations/_shared/media.ts";
import { parseChapterImages, parseChapterListFromApi, parseSearchResults } from "./parser.ts";
import type { CreateClientOptions, MangakakalotClient } from "./types.ts";
import { MangakakalotParseError } from "./types.ts";

export type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
export type { ImageRef } from "@integrations/_shared/media.ts";
export type { CreateClientOptions, FallbackChapterRef, MangakakalotClient } from "./types.ts";
export { MangakakalotParseError } from "./types.ts";

const SITE_ROOT = "https://www.mangakakalot.gg";
const SEARCH_URL = `${SITE_ROOT}/search/story`;
const CHAPTERS_API_URL = (slug: string, offset = 0) =>
  `${SITE_ROOT}/api/manga/${encodeURIComponent(slug)}/chapters?offset=${offset}`;

/** Guard against runaway pagination (e.g. malformed has_more loop). */
const MAX_API_PAGES = 20;

export function createMangakakalotClient(opts: CreateClientOptions): MangakakalotClient {
  const { http, logger } = opts;

  async function fetchHtml(url: string, extraHeaders?: Record<string, string>): Promise<string> {
    logger.info({ event: "mangakakalot.fetch", context: "mangakakalot", url }, "fetching HTML");
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
    const encoded = encodeURIComponent(toSearchSlug(title));
    const url = `${SEARCH_URL}/${encoded}`;
    const html = await fetchHtml(url);
    return runParser(url, () => parseSearchResults(html, url));
  }

  /** Fetches chapter list for a manga slug, re-sorting ascending across page boundaries. */
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

    allChapters.sort((a, b) => Number(a.chapter) - Number(b.chapter));

    return allChapters;
  }

  async function getChapterImages(chapterIdOrUrl: string): Promise<ImageRef[]> {
    const url = resolveChapterUrl(chapterIdOrUrl);
    const html = await fetchHtml(url);
    return runParser(url, () => parseChapterImages(html, url));
  }

  return { searchManga, getChapterList, getChapterImages };
}

/**
 * Resolves a chapter reference into a fetchable URL. Accepts a full URL, a
 * composite id "mangaSlug/chapter-slug" (from parseChapterListFromApi), or the
 * legacy path-style id "chapter/manga-slug/chapter-1" (kept for backward compat).
 */
function resolveChapterUrl(chapterIdOrUrl: string): string {
  if (chapterIdOrUrl.startsWith("http://") || chapterIdOrUrl.startsWith("https://")) {
    return chapterIdOrUrl;
  }
  const isLegacyChapterPath = chapterIdOrUrl.startsWith("chapter/");
  return isLegacyChapterPath
    ? `${SITE_ROOT}/${chapterIdOrUrl}`
    : `${SITE_ROOT}/manga/${chapterIdOrUrl}`;
}

function toSearchSlug(title: string): string {
  return title.toLowerCase().replace(/\s+/g, "_");
}
