import { ConfigError } from "@plugins/errors/index.ts";
import { check, isPlainObject } from "@plugins/guards/index.ts";
import { DEFAULT_CONFIG } from "./index.ts";
import type { Config } from "./types.ts";

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
