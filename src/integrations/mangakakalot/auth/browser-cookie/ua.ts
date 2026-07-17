// Best-effort user-agent derivation for the browser-cookie auto-extract flow.
//
// cf_clearance is bound to the exact UA the browser sent when solving the challenge.
// The cookie DB does not store it, so we reconstruct a Chromium-shaped UA from the
// browser's own app version. This is the fragile part called out in the discovery doc
// (docs/discovery/cf-cookie-autoextract-feasibility.md) — that's WHY the caller MUST
// validate the derived UA via the session probe before persisting, and fall back to
// manual paste on failure instead of silently persisting a broken session.

import type { ChromiumBrowserDef } from "./types.ts";

const MACOS_PLATFORM_TOKEN = "Macintosh; Intel Mac OS X 10_15_7";
/**
 * Baseline Chromium engine version used for the `Chrome/<version>` token when the browser
 * itself isn't Chrome (Opera/Brave/Edge ship their own version numbers that don't map
 * 1:1 to the underlying Chromium release). Kept as one constant so it's easy to bump.
 */
const FALLBACK_CHROMIUM_VERSION = "124.0.0.0";

/**
 * Builds a Chromium-family UA string for macOS from a detected browser + its app version.
 *
 * - Chrome: `Chrome/<version>` is the app version itself (Chrome's version IS the Chromium version).
 * - Opera/Brave/Edge: engine token uses `FALLBACK_CHROMIUM_VERSION` (best-effort), plus the
 *   browser's own product token + version appended (e.g. ` OPR/94.0.0.0`).
 */
export function deriveUserAgent(def: ChromiumBrowserDef, appVersion: string): string {
  const chromeVersion = def.id === "chrome" ? appVersion : FALLBACK_CHROMIUM_VERSION;
  const base = `Mozilla/5.0 (${MACOS_PLATFORM_TOKEN}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;

  if (!def.uaProductToken) return base;
  return `${base} ${def.uaProductToken}/${appVersion}`;
}
