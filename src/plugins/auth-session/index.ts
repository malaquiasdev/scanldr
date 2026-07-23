// Single owner of the auth-session validity check and cookie-header serialization,
// shared across integrations/fallback-http, pack/cover, and walkthrough/steps/auth-check.
//
// `loadAuthSession(path)` is intentionally NOT unified here: fallback-http's loader
// throws a typed MissingAuthError and logs via a required Logger, while pack/cover's
// loader is logger-less and silently falls back to a bare User-Agent on any failure
// (missing file, corrupt JSON, or a shape mismatch). Forcing those into one function
// would either add logging pack never had, or make fallback-http swallow the failure
// it depends on to enforce MissingAuthError callers can catch. See AGENTS.md / #239.

import type { AuthSession } from "./types.ts";

/** Structural validity check for a parsed auth.json payload. */
export function isValidAuthSession(v: unknown): v is AuthSession {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    obj.cookies !== null &&
    typeof obj.cookies === "object" &&
    !Array.isArray(obj.cookies) &&
    typeof obj.userAgent === "string" &&
    typeof obj.savedAt === "number"
  );
}

/** Serializes a cookie map into a `Cookie:` header value (`k=v; k2=v2`). */
export function toCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
