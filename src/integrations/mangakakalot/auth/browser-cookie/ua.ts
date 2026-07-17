// User-agent derivation for the browser-cookie auto-extract flow.
//
// cf_clearance is bound to the exact UA the browser sent when solving the challenge.
// The cookie DB does not store it. For Chrome, the app version IS the Chromium version,
// so we can reconstruct the exact UA. For Opera/Brave/Edge, the app version does NOT map
// 1:1 to the underlying Chromium release — any derived UA would be a fabrication that
// never matches what the browser actually sent, causing the cf_clearance probe to always
// fail (see issue #205). So for non-Chrome, we deliberately return undefined; the caller
// must prompt the human to paste their exact UA instead.

import type { ChromiumBrowserDef } from "./types.ts";

const MACOS_PLATFORM_TOKEN = "Macintosh; Intel Mac OS X 10_15_7";

/**
 * Derives the exact UA string for macOS Chrome from its app version.
 * Returns undefined for any non-Chrome browser — the app version doesn't reliably map to
 * the Chromium engine version for Opera/Brave/Edge, so no derivation would be trustworthy.
 * Callers must prompt for the exact UA in that case.
 */
export function deriveUserAgent(def: ChromiumBrowserDef, appVersion: string): string | undefined {
  if (def.id !== "chrome") return undefined;

  return `Mozilla/5.0 (${MACOS_PLATFORM_TOKEN}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${appVersion} Safari/537.36`;
}
