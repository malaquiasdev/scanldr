import type { ChapterRef, MangaCandidate } from "@integrations/mangadex/client/index.ts";
import type { MangaDexHttpClient } from "@integrations/mangadex/http/index.ts";
import type { BundleKind } from "@modules/downloader/index.ts";
import type { Config } from "@plugins/config/index.ts";
import type { Db } from "@plugins/db/index.ts";
import type { Logger } from "@plugins/logger/index.ts";

export interface NumericChoiceOptions {
  /** The header line shown above the numbered list. */
  header: string;
  /** The items to enumerate. */
  items: ReadonlyArray<{ display: string }>;
  /** Logger for warn-before-throw on invalid input. */
  logger: Logger;
  /** Optional context label for the warn payload (e.g. "download.candidate"). */
  event?: string;
}

export interface ParsedRange {
  /** Resolved tokens. Numeric tokens stored as strings; special token "none". */
  values: Set<string>;
}

export interface ResolveLanguageInput {
  preferred: readonly string[];
  available: readonly string[];
  nonTty: boolean;
  logger: Logger;
}

// Pack volume types

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
  logger: Logger;
}

export interface PackVolumeResult {
  outputPath: string;
  byteSize: number;
}

export interface PackPromptResult {
  shouldPack: boolean;
  shouldDelete: boolean;
  /** Volume name stem chosen by the user (may differ from the default). Undefined when pack was skipped. */
  volumeName?: string;
}

export interface PackPromptOptions {
  chapterCount: number;
  /** Manga slug (e.g. "dandadan") — used to build "<slug>-volume-<input>.cbz" from prompt input. */
  slug: string;
  /** Default output filename stem (e.g. "dandadan-volume-103-111") — shown as the leave-blank hint. */
  outputName: string;
  /** Default volume stem without manga slug prefix (e.g. "103-111") — shown in the volume-number prompt hint. */
  defaultVolumeStem: string;
  /**
   * Called with the *effective* output filename (after volume-number prompt) to check for
   * an existing file. Returns true when the file exists. Called after all name prompts resolve
   * so the check is always against the actual path that will be written.
   */
  checkExists: (filename: string) => Promise<boolean>;
  nonTty: boolean;
  /** --pack flag (boolean form — pack with default name, keep individuals) */
  packFlag: boolean;
  /** true when --pack <name> was supplied (skip volume-number prompt) */
  packNameProvided: boolean;
  /** --pack-replace flag (pack + delete individuals) */
  packReplace: boolean;
  /** --pack-overwrite flag (overwrite if exists) */
  packOverwrite: boolean;
  logger: Logger;
}

export interface DownloadArgs {
  manga: string;
  /** Set when --volume flag is provided */
  volume?: string;
  /** Set when --chapter flag is provided */
  chapter?: string;
  format: "cbz" | "zip";
  outDir: string;
  quality: "data" | "data-saver";
  concurrency: number;
  delayMs: number;
  force: boolean;
  noTrack: boolean;
  dryRun: boolean;
  nonTty: boolean;
  /** --pack [name] — pack downloaded chapters into a single volume cbz */
  pack?: string | boolean;
  /** --pack-replace — after packing, delete individual chapter files */
  packReplace: boolean;
  /** --pack-overwrite — overwrite existing packed file without prompting */
  packOverwrite: boolean;
}

export interface DownloadContext {
  logger: Logger;
  config: Config;
  db: Db;
}

export interface Bundle {
  kind: BundleKind;
  /** Used for the archive filename (e.g. "001", "018.5") */
  bundleNumber: string;
  /** Written to history rows — the chapter's real volume from MangaDex */
  volumeForHistory: string;
  chapters: ChapterRef[];
}

export interface ProcessBundleArgs {
  bundle: Bundle;
  chosen: MangaCandidate;
  slug: string;
  language: string;
  args: DownloadArgs;
  ctx: DownloadContext;
  http: MangaDexHttpClient;
}
