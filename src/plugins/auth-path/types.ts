// Types for the auth-path resolver plugin.
// Lifted from src/integrations/mangakakalot/browser/types.ts so that
// multiple integrations (mangakakalot, fallback-http, etc.) can resolve
// the same XDG-aware auth.json path without cross-integration imports.

export interface ResolveAuthPathOptions {
  /**
   * Base data directory override. Defaults to `$XDG_DATA_HOME` or `~/.local/share`.
   * Mostly for tests — production callers should rely on the default.
   */
  dataHome?: string;
  /** Override for `process.env`. Tests only. */
  env?: NodeJS.ProcessEnv;
  /** Override for `os.homedir()`. Tests only. */
  home?: string;
}
