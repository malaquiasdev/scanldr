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
  /**
   * Optional per-page progress callback, fired once per completed page (completion order,
   * NOT dispatch order — pages resolve out of order under concurrency). Callers should count
   * completions rather than rely on any index. Kept as a plain callback (not a renderer
   * dependency) so the downloader stays UI-agnostic.
   */
  onPageProgress?: (totalPages: number) => void;
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
