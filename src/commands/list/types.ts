import type { ChapterRef, MangaCandidate, VolumeRef } from "@integrations/mangadex/client/index.ts";
import type { Logger } from "@plugins/logger/index.ts";

export type { ChapterRef, MangaCandidate, VolumeRef };

export interface ListArgs {
  manga: string;
  volume?: string;
  chapter?: string;
  /** When true the process is not attached to a TTY (e.g. CI, pipes). */
  nonTty: boolean;
}

export interface ListContext {
  logger: Logger;
  /** BCP-47 language codes from config.preferred_languages */
  languages: string[];
}

export interface ChapterPageCount {
  id: string;
  pages: number;
}

// Minimal shape of what feedChapters returns but enriched with page count.
export interface ResolvedChapter extends ChapterRef {
  pages?: number;
}

export interface MangaDexClientLike {
  resolveTitleToId: (title: string) => Promise<MangaCandidate[]>;
  aggregateVolumes: (mangaId: string, languages: string[]) => Promise<VolumeRef[]>;
  feedChapters: (mangaId: string, languages: string[], offset?: number) => Promise<ChapterRef[]>;
}
