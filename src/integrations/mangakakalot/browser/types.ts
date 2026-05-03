// Types for the mangakakalot auth browser handler.
// Schema mirrors docs/models/auth_model.md.

export interface AuthSession {
  /** All cookies captured for the target host. May include cf_clearance when a challenge was shown. */
  cookies: Record<string, string>;
  /** User-Agent string used when the cookies were generated. */
  userAgent: string;
  /** Unix timestamp (ms) of when the session was saved. */
  savedAt: number;
}

export interface CookieLike {
  name: string;
  value: string;
}

export interface PollForClearanceOptions {
  /** Returns the current cookie jar — called on every poll tick. May throw AuthError. */
  getCookies: () => Promise<CookieLike[]>;
  /** Maximum time to wait before giving up, in milliseconds. */
  timeoutMs: number;
  /** Time between polls, in milliseconds. */
  intervalMs: number;
}

export interface RunAuthOptions {
  logger: import("@plugins/logger/index.ts").Logger;
  /**
   * Base data directory. Defaults to `$XDG_DATA_HOME` or `~/.local/share`.
   * Mostly for tests — production callers should rely on the default.
   */
  dataHome?: string;
  /** Override for `process.env`. Tests only. */
  env?: NodeJS.ProcessEnv;
  /** Override for `os.homedir()`. Tests only. */
  home?: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
