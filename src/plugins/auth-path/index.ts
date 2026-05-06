// XDG-aware auth.json path resolver.
// Shared by src/integrations/mangakakalot/auth/ and src/integrations/fallback-http/
// so all integrations resolve the same auth.json path.

import { homedir } from "node:os";
import { join } from "node:path";
import type { ResolveAuthPathOptions } from "./types.ts";

export type { ResolveAuthPathOptions } from "./types.ts";

const AUTH_FILENAME = "auth.json";
const APP_DIR = "scanldr";

/**
 * Resolves the absolute path where the auth session is persisted.
 *
 * Order:
 * 1. `opts.dataHome` (test override) → `<dataHome>/scanldr/auth.json`
 * 2. `$XDG_DATA_HOME/scanldr/auth.json`
 * 3. `<home>/.local/share/scanldr/auth.json`
 */
export function resolveAuthPath(opts: ResolveAuthPathOptions = {}): string {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const base =
    opts.dataHome ??
    (env.XDG_DATA_HOME && env.XDG_DATA_HOME.length > 0
      ? env.XDG_DATA_HOME
      : join(home, ".local", "share"));
  return join(base, APP_DIR, AUTH_FILENAME);
}
