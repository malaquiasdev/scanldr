// Internal types for the MangaDex client layer.
// API response shapes (MdX*) stay here and never leak past parser.ts.

export interface MangaCandidate {
  id: string;
  title: string;
  originalLanguage: string;
  year: number | null;
}

export interface VolumeRef {
  volume: string;
  numeric: number;
  chapterIds: string[];
}

export interface ChapterRef {
  id: string;
  volume: string | null;
  chapter: string | null;
  title: string | null;
  translatedLanguage: string;
  scanlationGroup: string | null;
  readableAt: string;
  externalUrl: string | null;
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
}

export interface MangaDexClient {
  searchManga: (title: string, lang?: string) => Promise<MangaCandidate[]>;
  aggregateVolumes: (mangaId: string, languages: string[]) => Promise<VolumeRef[]>;
  feedChapters: (mangaId: string, languages: string[], offset?: number) => Promise<ChapterRef[]>;
  resolveTitleToId: (title: string) => Promise<MangaCandidate[]>;
}
