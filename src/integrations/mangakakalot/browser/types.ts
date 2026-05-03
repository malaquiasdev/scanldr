// Types for the mangakakalot auth browser handler.
// Schema mirrors docs/models/auth_model.md.

export interface AuthSession {
  /** All cookies captured for the target host. Must include cf_clearance. */
  cookies: Record<string, string>;
  /** User-Agent string used when the cookies were generated. */
  userAgent: string;
  /** Unix timestamp (ms) of when the session was saved. */
  savedAt: number;
}

export interface RunAuthOptions {
  logger: import("@plugins/logger/index.ts").Logger;
  cwd?: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
