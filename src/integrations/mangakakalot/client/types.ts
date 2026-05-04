// Public types and domain errors for the mangakakalot client.

import type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
import type { ImageRef } from "@modules/downloader/types.ts";

export type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
export type { ImageRef } from "@modules/downloader/types.ts";

export class MangakakalotParseError extends Error {
  override readonly name = "MangakakalotParseError";
  constructor(
    public readonly selector: string,
    public readonly url: string,
    message: string,
  ) {
    super(`[mangakakalot] parse failed at selector "${selector}" on ${url}: ${message}`);
  }
}

export interface MangakakalotClient {
  searchManga(title: string): Promise<MangaCandidate[]>;
  getChapterList(slug: string): Promise<ChapterRef[]>;
  getChapterImages(chapterIdOrUrl: string): Promise<ImageRef[]>;
}
