import type { MangaDexHttpClient } from "@integrations/mangadex/http/index.ts";
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

export function createMangaDexClient(http: MangaDexHttpClient): MangaDexClient {
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
    const raw = await http.get<MdxChapterListResponse>(`/manga/${mangaId}/feed`, {
      "translatedLanguage[]": languages.map((l) => l.toLowerCase()),
      "includes[]": "scanlation_group",
      limit: 500,
      offset,
      "order[chapter]": "asc",
    });
    return parseChapterFeed(raw);
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
