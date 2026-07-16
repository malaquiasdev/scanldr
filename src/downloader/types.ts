import type { ChapterInput } from "@integrations/_shared/media.ts";
import type { Logger } from "@plugins/logger/index.ts";

export type BundleKind = "chapter";

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
  /** Fires per completion, not dispatch order. */
  onPageCompleted?: (totalPages: number) => void;
}

export interface DownloadBundleResult {
  chapterIds: string[];
  outputPath: string;
  byteSize: number;
}

export interface Semaphore {
  run: <T>(fn: () => Promise<T>) => Promise<T>;
}

/** A single fetched page, before filename assignment. */
export interface RawPage {
  data: Uint8Array;
  ext: string;
}

/** Width/height of a decoded page image, used to drive tile grouping. */
export interface PageDims {
  width: number;
  height: number;
}
