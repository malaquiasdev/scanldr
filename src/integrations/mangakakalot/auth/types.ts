// Types for the mangakakalot manual cURL auth flow.

export interface AuthSession {
  /** All cookies parsed from the cURL. Must include cf_clearance. */
  cookies: Record<string, string>;
  /** User-Agent string from the copied request. */
  userAgent: string;
  /** Unix timestamp (ms) of when the session was saved. */
  savedAt: number;
}

export interface ParsedCurl {
  /** Target URL from the cURL command. */
  url: string;
  /** All cookies parsed (both -H cookie and -b flag forms). */
  cookies: Record<string, string>;
  /** User-Agent extracted (case-insensitive header match). */
  userAgent: string | undefined;
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
  /**
   * Override for reading stdin. Defaults to reading process.stdin.
   * Tests only.
   */
  readStdin?: () => Promise<string>;
  /**
   * Override fetch for testing. Defaults to globalThis.fetch.
   */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /**
   * Whether stdin is an interactive TTY. Defaults to `process.stdin.isTTY`.
   * Injected by tests to avoid touching the real process descriptor.
   */
  isTTY?: boolean;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
