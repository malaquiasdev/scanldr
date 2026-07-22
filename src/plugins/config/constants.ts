import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "./types.ts";

export const DEFAULT_CONFIG: Config = {
  default_format: "cbz",
  default_out: "./download",
  db_path: join(homedir(), ".local", "share", "scanldr", "scanldr.db"),
  image_concurrency: 4,
  chapter_delay_ms: 1000,
  search_cache_ttl_days: 15,
  chapter_cache_ttl_days: 15,
};
