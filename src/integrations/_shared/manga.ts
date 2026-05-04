// Shared manga domain types used across integrations (mangadex, mangakakalot, etc.).
// Both integration clients depend on this module — never import types from one integration into another.

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
