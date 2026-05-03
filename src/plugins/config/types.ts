export interface Config {
  preferred_languages: string[];
  download_quality: "data" | "data-saver";
  default_format: "cbz" | "zip";
  default_out: string;
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
