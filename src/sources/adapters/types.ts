// Source adapter interface — boundary between walkthrough and integration clients.
// Each adapter wraps an integration client and maps it to walkthrough DTOs.

import type { ChapterInput } from "@integrations/_shared/media.ts";
import type { ChapterListing, SearchHit } from "../../walkthrough/types.ts";

export type { ChapterListing, SearchHit };

export interface SourceAdapter {
  search(query: string): Promise<SearchHit[]>;
  /** List chapters for the given hit id. */
  listChapters(hitId: string): Promise<ChapterListing[]>;
  /**
   * Resolve a chapter id (from listChapters) to a ChapterInput
   * ready for the downloader service.
   * @param chapterNum optional chapter number string (e.g. "103.5") — used to populate ChapterInput.num.
   */
  fetchChapterInput(chapterId: string, chapterNum?: string): Promise<ChapterInput>;
}
