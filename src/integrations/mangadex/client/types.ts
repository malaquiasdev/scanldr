// Internal types for the MangaDex client layer.
// API response shapes (MdX*) stay here and never leak past parser.ts.
// Domain types (MangaCandidate, ChapterRef, VolumeRef) live in _shared/manga.ts — re-exported here for backwards compat.

import type { ChapterRef, MangaCandidate, VolumeRef } from "@integrations/_shared/manga.ts";

export type { ChapterRef, MangaCandidate, VolumeRef };

/** Thrown by resolveTitleToId when the MangaDex search returns zero results. */
export class TitleNotFoundError extends Error {
  override readonly name = "TitleNotFoundError";
  constructor(public readonly title: string) {
    super(`No manga found for title: "${title}"`);
  }
}

// --- MangaDex REST response shapes ---

export interface MdxLocalizedString {
  [lang: string]: string;
}

export interface MdxRelationship {
  id: string;
  type: string;
  attributes?: {
    name?: string;
    [key: string]: unknown;
  };
}

export interface MdxMangaAttributes {
  title: MdxLocalizedString;
  originalLanguage: string;
  year: number | null;
}

export interface MdxMangaData {
  id: string;
  type: "manga";
  attributes: MdxMangaAttributes;
}

export interface MdxMangaListResponse {
  result: string;
  data: MdxMangaData[];
}

export interface MdxAggregateChapter {
  chapter: string;
  id: string;
  others: string[];
  count: number;
}

export interface MdxAggregateVolume {
  volume: string;
  count: number;
  chapters: Record<string, MdxAggregateChapter>;
}

export interface MdxAggregateResponse {
  result: string;
  volumes: Record<string, MdxAggregateVolume>;
}

export interface MdxChapterAttributes {
  volume: string | null;
  chapter: string | null;
  title: string | null;
  translatedLanguage: string;
  readableAt: string;
  externalUrl: string | null;
}

export interface MdxChapterData {
  id: string;
  type: "chapter";
  attributes: MdxChapterAttributes;
  relationships: MdxRelationship[];
}

export interface MdxChapterListResponse {
  result: string;
  data: MdxChapterData[];
  limit: number;
  offset: number;
  total: number;
}

export interface MangaDexClient {
  searchManga: (title: string, lang?: string) => Promise<MangaCandidate[]>;
  aggregateVolumes: (mangaId: string, languages: string[]) => Promise<VolumeRef[]>;
  feedChapters: (mangaId: string, languages: string[], offset?: number) => Promise<ChapterRef[]>;
  resolveTitleToId: (title: string) => Promise<MangaCandidate[]>;
}
