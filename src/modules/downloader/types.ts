import type { Logger } from "@plugins/logger/index.ts";

export interface ImageRef {
  url: string;
  page: number;
}

export interface ChapterInput {
  id: string;
  num: number;
  pages: ImageRef[];
  imageFetcher: (ref: ImageRef) => Promise<Uint8Array>;
}

export type BundleKind = "volume" | "chapter";

export interface DownloadBundleInput {
  outDir: string;
  format: "cbz" | "zip";
  slug: string;
  kind: BundleKind;
  /** "1", "018", "18.5", "none" — stringly typed for decimals & special tokens */
  bundleNumber: string;
  chapters: ChapterInput[];
  imageConcurrency: number;
  delayMs: number;
  dryRun: boolean;
  logger: Logger;
}

export interface DownloadBundleResult {
  chapterIds: string[];
  outputPath: string;
  byteSize: number;
}

export interface Semaphore {
  run: <T>(fn: () => Promise<T>) => Promise<T>;
}
