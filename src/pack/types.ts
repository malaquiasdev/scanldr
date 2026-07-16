// Types shared by pack.ts and cover.ts

export interface CoverImage {
  bytes: Uint8Array;
  /** File extension including dot, e.g. ".jpg" */
  ext: string;
}

export interface PackedChapter {
  /** The chapter number token (e.g. "103", "18.5") */
  num: string;
  /** Absolute path to the individual .cbz file */
  outputPath: string;
}

export interface PackVolumeInput {
  slug: string;
  outDir: string;
  chapters: PackedChapter[];
  /** Override the output filename stem (without extension). */
  customName?: string;
  /** Optional cover image to write as 00_cover.<ext> at root of zip. */
  cover?: CoverImage;
  logger: import("@plugins/logger/index.ts").Logger;
}

export interface PackVolumeResult {
  outputPath: string;
  byteSize: number;
}
