export interface Config {
  default_format: "cbz" | "zip";
  default_out: string;
  db_path: string;
  image_concurrency: number;
  chapter_delay_ms: number;
  /** TTL (days) for cached search results (#164). Default 15. */
  search_cache_ttl_days: number;
  /** TTL (days) for cached chapter lists (#164). Default 15. */
  chapter_cache_ttl_days: number;
}

export interface LoadConfigOptions {
  configPath?: string | undefined;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  home?: string;
}

export interface LoadConfigResult {
  config: Config;
  source: string | null;
}
