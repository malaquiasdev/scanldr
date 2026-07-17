// Public surface for the macOS/Chromium browser-cookie auto-extraction flow (issue #202).
// Orchestrates: locate profiles → copy DB → query cf_* rows → pick freshest profile →
// decrypt via Keychain-derived key → derive UA. Does NOT validate or persist — the
// caller (walkthrough auth-check step) is responsible for probing before persisting,
// per the "never silently produce a broken session" requirement.

import { decryptV10 } from "./decrypt.ts";
import { selectFreshestProfile } from "./profiles.ts";
import type {
  BrowserCookieDeps,
  ChromiumBrowserDef,
  ExtractBrowserSessionOptions,
  ExtractedBrowserSession,
  ProfileCookies,
} from "./types.ts";
import { deriveUserAgent } from "./ua.ts";

export { CHROMIUM_BROWSERS, listChromiumBrowserDefs } from "./browsers.ts";
export { decryptV10 } from "./decrypt.ts";
export { selectFreshestProfile } from "./profiles.ts";
export {
  copyCookieDb,
  isBrowserInstalled,
  listProfiles,
  queryCookies,
  readAppVersion,
  removeTempFile,
} from "./store.ts";
export type {
  BrowserCookieDeps,
  ChromiumBrowserDef,
  ChromiumBrowserId,
  ExtractBrowserSessionOptions,
  ExtractedBrowserSession,
} from "./types.ts";
export { deriveUserAgent } from "./ua.ts";

/** Reads all cf_* cookies for every profile of one browser. Cleans up temp DB copies. */
async function readAllProfileCookies(
  def: ChromiumBrowserDef,
  domainFilter: string,
  deps: BrowserCookieDeps,
): Promise<ProfileCookies[]> {
  const profiles = deps.listProfiles(def.supportDirName);
  const result: ProfileCookies[] = [];

  for (const profile of profiles) {
    const dbPath = deps.copyCookieDb(def.supportDirName, profile);
    if (!dbPath) continue;
    try {
      const rows = deps.queryCookies(dbPath, domainFilter);
      result.push({ profile, rows });
    } finally {
      deps.removeTempFile(dbPath);
    }
  }

  return result;
}

/**
 * Extracts + decrypts the domain's cf_* cookies from the freshest profile of the given
 * browser, and derives the matching user-agent.
 *
 * Returns undefined (graceful fallback — caller should offer manual paste instead) when:
 * - the browser isn't installed
 * - no profile has a cookie store reachable
 * - no profile has a `cf_clearance` cookie for the domain
 */
export async function extractBrowserSession(
  opts: ExtractBrowserSessionOptions,
  browserDef: ChromiumBrowserDef,
): Promise<ExtractedBrowserSession | undefined> {
  const { deps, domainFilter } = opts;

  if (!deps.isBrowserInstalled(browserDef)) return undefined;

  const profileCookies = await readAllProfileCookies(browserDef, domainFilter, deps);
  const chosen = selectFreshestProfile(profileCookies);
  if (!chosen) return undefined;

  const password = await deps.readKeychainPassword(browserDef.keychainService);

  const cookies: Record<string, string> = {};
  for (const row of chosen.rows) {
    if (row.name !== "cf_clearance" && !row.name.startsWith("cf_")) continue;
    try {
      cookies[row.name] = decryptV10(row.encryptedValue, password);
    } catch {
      // Skip cookies we can't decrypt (unexpected scheme); cf_clearance failing here
      // means the caller's probe validation will reject the session downstream.
    }
  }

  if (!cookies.cf_clearance) return undefined;

  const appVersion = deps.readAppVersion(browserDef.appBundlePath) ?? "0.0.0.0";
  const userAgent = deriveUserAgent(browserDef, appVersion);

  return {
    cookies,
    userAgent,
    browser: browserDef.id,
    profile: chosen.profile,
  };
}
