import type { MangaDexHttpClient } from "@integrations/mangadex/http/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import { parseAggregate, parseChapterFeed, parseMangaList } from "./parser.ts";
import type {
  ChapterRef,
  MangaCandidate,
  MangaDexClient,
  MdxAggregateResponse,
  MdxChapterListResponse,
  MdxMangaListResponse,
  VolumeRef,
} from "./types.ts";
import { TitleNotFoundError } from "./types.ts";

export type { ChapterRef, MangaCandidate, MangaDexClient, VolumeRef } from "./types.ts";
export { TitleNotFoundError } from "./types.ts";

const FEED_PAGE_LIMIT = 500;
/** Guard against runaway pagination (e.g. malformed/missing `total`). */
const MAX_FEED_PAGES = 20;

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export function createMangaDexClient(
  http: MangaDexHttpClient,
  logger: Logger = noopLogger,
): MangaDexClient {
  async function searchManga(title: string, lang?: string): Promise<MangaCandidate[]> {
    const query: Record<string, string | string[] | number | boolean | undefined> = {
      title,
      limit: 10,
    };
    if (lang) {
      query["availableTranslatedLanguage[]"] = lang;
    }
    const raw = await http.get<MdxMangaListResponse>("/manga", query);
    return parseMangaList(raw);
  }

  async function aggregateVolumes(mangaId: string, languages: string[]): Promise<VolumeRef[]> {
    const raw = await http.get<MdxAggregateResponse>(`/manga/${mangaId}/aggregate`, {
      "translatedLanguage[]": languages.map((l) => l.toLowerCase()),
    });
    return parseAggregate(raw);
  }

  async function feedChapters(
    mangaId: string,
    languages: string[],
    offset = 0,
  ): Promise<ChapterRef[]> {
    const allRefs: ChapterRef[] = [];
    let currentOffset = offset;
    let pagesLoaded = 0;
    let total = currentOffset;

    while (pagesLoaded < MAX_FEED_PAGES) {
      const raw = await http.get<MdxChapterListResponse>(`/manga/${mangaId}/feed`, {
        "translatedLanguage[]": languages.map((l) => l.toLowerCase()),
        "includes[]": "scanlation_group",
        limit: FEED_PAGE_LIMIT,
        offset: currentOffset,
        "order[chapter]": "asc",
      });
      const refs = parseChapterFeed(raw);
      allRefs.push(...refs);
      pagesLoaded++;

      if (refs.length === 0) break;

      currentOffset += raw.limit ?? FEED_PAGE_LIMIT;
      total = raw.total ?? currentOffset;
      if (currentOffset >= total) break;
    }

    if (pagesLoaded >= MAX_FEED_PAGES && currentOffset < total) {
      logger.warn(
        {
          event: "mangadex.feed_pagination_capped",
          context: "mangadex",
          mangaId,
          cap: MAX_FEED_PAGES,
        },
        "chapter feed pagination cap reached; chapter list may be incomplete",
      );
    }

    return allRefs;
  }

  async function resolveTitleToId(title: string): Promise<MangaCandidate[]> {
    const candidates = await searchManga(title);
    if (candidates.length === 0) {
      throw new TitleNotFoundError(title);
    }
    return candidates;
  }

  return { searchManga, aggregateVolumes, feedChapters, resolveTitleToId };
}
