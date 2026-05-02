// scanldr.json loader — discovery order and defaults per docs/overviewer.md §5.
//
// Discovery order (first match wins):
//   1. explicit path argument (e.g. CLI `--config <path>`)
//   2. $SCANLDR_CONFIG environment variable
//   3. ./scanldr.json in the current working directory
//   4. $XDG_CONFIG_HOME/scanldr/scanldr.json
//      (or ~/.config/scanldr/scanldr.json if XDG_CONFIG_HOME is unset)
//
// Missing file ⇒ all defaults apply silently.
// Partial file ⇒ provided fields override defaults; the rest fall back.
// Malformed JSON or invalid value ⇒ ConfigError, caller decides exit policy.

import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  preferred_languages: string[];
  download_quality: "data" | "data-saver";
  default_format: "cbz" | "zip";
  default_out: string;
  image_concurrency: number;
  chapter_delay_ms: number;
}

export const DEFAULT_CONFIG: Config = {
  preferred_languages: ["en", "pt-BR"],
  download_quality: "data",
  default_format: "cbz",
  default_out: "./download",
  image_concurrency: 4,
  chapter_delay_ms: 1000,
};

export class ConfigError extends Error {
  override readonly name = "ConfigError";
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message);
  }
}

export interface LoadConfigOptions {
  /** Path passed via `--config <path>` (highest priority). */
  configPath?: string | undefined;
  /** Override for `process.env`. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Override for `process.cwd()`. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Override for `os.homedir()`. Defaults to `os.homedir()`. */
  home?: string;
}

export interface LoadConfigResult {
  config: Config;
  /** Absolute path that was loaded; `null` when no config file was found. */
  source: string | null;
}

// BCP 47 — loose check, not full RFC compliance.
// Matches: "en", "pt", "pt-BR", "zh-CN", optionally with extra subtags.
const BCP47 = /^[a-z]{2,3}(?:-[A-Z]{2})?(?:-[a-zA-Z0-9]{1,8})*$/;

const VALID_QUALITY = ["data", "data-saver"] as const;
const VALID_FORMAT = ["cbz", "zip"] as const;

/**
 * Resolve which config file path the loader should read, following the
 * discovery order in §5. Returns `null` when no candidate exists on disk.
 */
async function resolveConfigPath(opts: LoadConfigOptions): Promise<string | null> {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();

  // 1. Explicit --config flag — must exist; fail loudly if not.
  if (opts.configPath) {
    const exists = await Bun.file(opts.configPath).exists();
    if (!exists) {
      throw new ConfigError(`--config path does not exist: ${opts.configPath}`, opts.configPath);
    }
    return opts.configPath;
  }

  // 2. $SCANLDR_CONFIG — must exist; fail loudly if not.
  const envPath = env.SCANLDR_CONFIG;
  if (envPath) {
    const exists = await Bun.file(envPath).exists();
    if (!exists) {
      throw new ConfigError(`$SCANLDR_CONFIG points to a missing file: ${envPath}`, envPath);
    }
    return envPath;
  }

  // 3. ./scanldr.json — silent skip when missing.
  const cwdPath = join(cwd, "scanldr.json");
  if (await Bun.file(cwdPath).exists()) {
    return cwdPath;
  }

  // 4. $XDG_CONFIG_HOME/scanldr/scanldr.json (or ~/.config/scanldr/scanldr.json).
  const xdgBase =
    env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0
      ? env.XDG_CONFIG_HOME
      : join(home, ".config");
  const xdgPath = join(xdgBase, "scanldr", "scanldr.json");
  if (await Bun.file(xdgPath).exists()) {
    return xdgPath;
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a parsed JSON object and merge it on top of defaults.
 * Throws ConfigError naming the offending field on the first invalid value.
 */
export function validateAndMerge(parsed: unknown, source?: string): Config {
  if (!isPlainObject(parsed)) {
    throw new ConfigError(
      `config root must be a JSON object, got ${parsed === null ? "null" : typeof parsed}`,
      source,
    );
  }

  const merged: Config = { ...DEFAULT_CONFIG };

  if ("preferred_languages" in parsed) {
    const langs = parsed.preferred_languages;
    if (!Array.isArray(langs) || langs.length === 0) {
      throw new ConfigError(
        "preferred_languages must be a non-empty array of BCP 47 codes",
        source,
      );
    }
    for (const lang of langs) {
      if (typeof lang !== "string" || lang.length === 0 || !BCP47.test(lang)) {
        throw new ConfigError(
          `preferred_languages contains invalid BCP 47 code: ${JSON.stringify(lang)}`,
          source,
        );
      }
    }
    merged.preferred_languages = langs as string[];
  }

  if ("download_quality" in parsed) {
    const q = parsed.download_quality;
    if (q !== "data" && q !== "data-saver") {
      throw new ConfigError(
        `download_quality must be one of ${VALID_QUALITY.join(" | ")}, got ${JSON.stringify(q)}`,
        source,
      );
    }
    merged.download_quality = q;
  }

  if ("default_format" in parsed) {
    const f = parsed.default_format;
    if (f !== "cbz" && f !== "zip") {
      throw new ConfigError(
        `default_format must be one of ${VALID_FORMAT.join(" | ")}, got ${JSON.stringify(f)}`,
        source,
      );
    }
    merged.default_format = f;
  }

  if ("default_out" in parsed) {
    const o = parsed.default_out;
    if (typeof o !== "string" || o.length === 0) {
      throw new ConfigError(
        `default_out must be a non-empty string, got ${JSON.stringify(o)}`,
        source,
      );
    }
    merged.default_out = o;
  }

  if ("image_concurrency" in parsed) {
    const n = parsed.image_concurrency;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
      throw new ConfigError(
        `image_concurrency must be an integer >= 1, got ${JSON.stringify(n)}`,
        source,
      );
    }
    merged.image_concurrency = n;
  }

  if ("chapter_delay_ms" in parsed) {
    const n = parsed.chapter_delay_ms;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
      throw new ConfigError(
        `chapter_delay_ms must be a number >= 0, got ${JSON.stringify(n)}`,
        source,
      );
    }
    merged.chapter_delay_ms = n;
  }

  return merged;
}

/**
 * Load the resolved config. Returns defaults when no file is found.
 * Throws `ConfigError` for malformed JSON or invalid field values — the
 * caller (CLI entrypoint) is responsible for printing and exiting non-zero.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadConfigResult> {
  const path = await resolveConfigPath(options);

  if (path === null) {
    return { config: { ...DEFAULT_CONFIG }, source: null };
  }

  let parsed: unknown;
  try {
    parsed = await Bun.file(path).json();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`failed to parse ${path}: ${reason}`, path);
  }

  const config = validateAndMerge(parsed, path);
  return { config, source: path };
}
