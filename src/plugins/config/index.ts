// scanldr.json loader — discovery order and defaults per docs/overviewer.md §5.

import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "@plugins/errors/index.ts";
import { DEFAULT_CONFIG } from "./constants.ts";
import { validateAndMerge } from "./service.ts";
import type { LoadConfigOptions, LoadConfigResult } from "./types.ts";

export { DEFAULT_CONFIG } from "./constants.ts";
export { validateAndMerge } from "./service.ts";
export type { Config, LoadConfigOptions, LoadConfigResult } from "./types.ts";

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
