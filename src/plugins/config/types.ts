export interface Config {
  default_format: "cbz" | "zip";
  default_out: string;
  db_path: string;
  image_concurrency: number;
  chapter_delay_ms: number;
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
