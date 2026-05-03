// Types for the downloader module — see docs/overviewer.md §3.6

/** A single page reference passed in by the caller. */
export interface ImageRef {
  /** Absolute URL (or opaque key) identifying the image. */
  url: string;
  /** 1-based page number within the chapter. */
  page: number;
}

/** A single chapter's metadata + page list. */
export interface ChapterInput {
  /** Opaque chapter ID (used in the result for history recording). */
  id: string;
  /** Chapter number (for sorting within the volume). */
  num: number;
  /** Ordered list of pages. */
  pages: ImageRef[];
}

/** Input to downloadVolume(). */
export interface DownloadVolumeInput {
  /** Root output directory (e.g. `./download`). */
  outDir: string;
  /** Archive format. Only "cbz" is supported today. */
  format: "cbz" | "zip";
  /** Manga slug used in the output filename (e.g. `witch-hat-atelier`). */
  slug: string;
  /** Volume number, zero-padded to 3 digits in the filename (e.g. 3 → "003"). */
  volumeNumber: number;
  /** Chapters belonging to this volume, in chapter order. */
  chapters: ChapterInput[];
  /** Maximum number of image fetches in flight at any one time. */
  imageConcurrency: number;
  /** Milliseconds to wait between chapters (rate-limit courtesy). */
  delayMs: number;
  /**
   * When true, skip all network and disk I/O and return a description of what
   * would be produced.
   */
  dryRun: boolean;
  /**
   * Caller-supplied image fetcher. Decouples the downloader from MangaDex or
   * any other source. Returns the raw image bytes.
   */
  imageFetcher: (ref: ImageRef) => Promise<Uint8Array>;
}

/** Result returned by downloadVolume(). */
export interface DownloadVolumeResult {
  /** IDs of every chapter packaged into the archive (for history recording). */
  chapterIds: string[];
  /**
   * Absolute path of the final `.cbz` file, or a planned-output description
   * when dryRun is true.
   */
  outputPath: string;
  /** Archive byte size in bytes (0 when dryRun is true). */
  byteSize: number;
}
