import type { Config } from "@plugins/config/index.ts";
import type { Db } from "@plugins/db/index.ts";
import type { Logger } from "@plugins/logger/index.ts";

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
  volume: string;
  format: "cbz" | "zip";
  outDir: string;
  quality: "data" | "data-saver";
  concurrency: number;
  delayMs: number;
  force: boolean;
  noTrack: boolean;
  dryRun: boolean;
  nonTty: boolean;
}

export interface DownloadContext {
  logger: Logger;
  config: Config;
  db: Db;
}
