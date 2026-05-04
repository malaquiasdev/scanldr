// Types for the fallback download path.
// Keep separate from types.ts to avoid circular-import risk between fallback.ts and index.ts.

import type { ChapterRef, MangaCandidate, VolumeRef } from "@integrations/_shared/manga.ts";

export interface FallbackSiteOption {
  name: string; // "mangakakalot"
  display: string; // "mangakakalot.gg"
}

/**
 * Result of the tryMangaDexPipeline step.
 * language is null when no chapters matched the preferred languages.
 */
export interface MangaDexResolveResult {
  candidate: MangaCandidate;
  volumes: VolumeRef[];
  chaptersInLang: ChapterRef[];
  language: string | null;
}

export interface FallbackBundle {
  kind: "volume" | "chapter";
  bundleNumber: string;
  volumeForHistory: string;
  chapters: ChapterRef[];
}
