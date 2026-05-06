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
