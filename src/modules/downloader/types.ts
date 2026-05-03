import type { Logger } from "@plugins/logger/index.ts";

export interface ImageRef {
  url: string;
  page: number;
}

export interface ChapterInput {
  id: string;
  num: number;
  pages: ImageRef[];
}

export interface DownloadVolumeInput {
  outDir: string;
  format: "cbz" | "zip";
  slug: string;
  volumeNumber: number;
  chapters: ChapterInput[];
  imageConcurrency: number;
  delayMs: number;
  dryRun: boolean;
  logger: Logger;
  imageFetcher: (ref: ImageRef) => Promise<Uint8Array>;
}

export interface DownloadVolumeResult {
  chapterIds: string[];
  outputPath: string;
  byteSize: number;
}

export interface Semaphore {
  run: <T>(fn: () => Promise<T>) => Promise<T>;
}
