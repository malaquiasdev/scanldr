// scanldr.json loader — discovery order and defaults per docs/overviewer.md §5.

import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "@plugins/errors/index.ts";
import { check, isPlainObject } from "@plugins/guards/index.ts";
import type { Config, LoadConfigOptions, LoadConfigResult } from "./types.ts";

export type { Config, LoadConfigOptions, LoadConfigResult } from "./types.ts";

export const DEFAULT_CONFIG: Config = {
  default_format: "cbz",
  default_out: "./download",
  db_path: join(homedir(), ".local", "share", "scanldr", "scanldr.db"),
  image_concurrency: 4,
  chapter_delay_ms: 1000,
  search_cache_ttl_days: 15,
  chapter_cache_ttl_days: 15,
};

async function resolveConfigPath(opts: LoadConfigOptions): Promise<string | null> {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();

  if (opts.configPath) {
    if (!(await Bun.file(opts.configPath).exists())) {
      throw new ConfigError(`--config path does not exist: ${opts.configPath}`, opts.configPath);
    }
    return opts.configPath;
  }

  const envPath = env.SCANLDR_CONFIG;
  if (envPath) {
    if (!(await Bun.file(envPath).exists())) {
      throw new ConfigError(`$SCANLDR_CONFIG points to a missing file: ${envPath}`, envPath);
    }
    return envPath;
  }

  const cwdPath = join(cwd, "scanldr.json");
  if (await Bun.file(cwdPath).exists()) return cwdPath;

  const xdgBase = env.XDG_CONFIG_HOME?.length ? env.XDG_CONFIG_HOME : join(home, ".config");
  const xdgPath = join(xdgBase, "scanldr", "scanldr.json");
  if (await Bun.file(xdgPath).exists()) return xdgPath;

  return null;
}

export function validateAndMerge(parsed: unknown, source?: string): Config {
  check(
    isPlainObject(parsed),
    new ConfigError(
      `config root must be a JSON object, got ${parsed === null ? "null" : typeof parsed}`,
      source,
    ),
  );

  const merged: Config = { ...DEFAULT_CONFIG };
  const p = parsed;

  if ("default_format" in p) {
    const v = p.default_format;
    check(
      v === "cbz" || v === "zip",
      new ConfigError("default_format must be 'cbz' or 'zip'", source),
    );
    merged.default_format = v;
  }

  if ("default_out" in p) {
    const v = p.default_out;
    check(
      typeof v === "string" && v.length > 0,
      new ConfigError("default_out must be a non-empty string", source),
    );
    merged.default_out = v;
  }

  if ("image_concurrency" in p) {
    const v = p.image_concurrency;
    check(
      typeof v === "number" && Number.isInteger(v) && v >= 1,
      new ConfigError("image_concurrency must be an integer >= 1", source),
    );
    merged.image_concurrency = v;
  }

  if ("db_path" in p) {
    const v = p.db_path;
    check(
      typeof v === "string" && v.length > 0,
      new ConfigError("db_path must be a non-empty string", source),
    );
    merged.db_path = v;
  }

  if ("chapter_delay_ms" in p) {
    const v = p.chapter_delay_ms;
    check(
      typeof v === "number" && Number.isFinite(v) && v >= 0,
      new ConfigError("chapter_delay_ms must be a number >= 0", source),
    );
    merged.chapter_delay_ms = v;
  }

  if ("search_cache_ttl_days" in p) {
    const v = p.search_cache_ttl_days;
    check(
      typeof v === "number" && Number.isFinite(v) && v >= 0,
      new ConfigError("search_cache_ttl_days must be a number >= 0", source),
    );
    merged.search_cache_ttl_days = v;
  }

  if ("chapter_cache_ttl_days" in p) {
    const v = p.chapter_cache_ttl_days;
    check(
      typeof v === "number" && Number.isFinite(v) && v >= 0,
      new ConfigError("chapter_cache_ttl_days must be a number >= 0", source),
    );
    merged.chapter_cache_ttl_days = v;
  }

  return merged;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadConfigResult> {
  const path = await resolveConfigPath(options);
  if (path === null) return { config: { ...DEFAULT_CONFIG }, source: null };

  let parsed: unknown;
  try {
    parsed = await Bun.file(path).json();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`failed to parse ${path}: ${reason}`, path);
  }

  return { config: validateAndMerge(parsed, path), source: path };
}
