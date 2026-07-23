export interface AuthSession {
  /** All cookies parsed from the cURL. Must include cf_clearance. */
  cookies: Record<string, string>;
  /** User-Agent string from the copied request. */
  userAgent: string;
  /** Unix timestamp (ms) of when the session was saved. */
  savedAt: number;
}
