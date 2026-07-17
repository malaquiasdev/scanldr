// Real filesystem + bun:sqlite seams for reading a Chromium cookie store on macOS.
// Kept separate from index.ts so tests can inject fakes for the whole BrowserCookieDeps
// surface without ever touching the real disk.

import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ChromiumBrowserDef, CookieRow } from "./types.ts";

/** Escapes SQL LIKE wildcards (`%`, `_`) and the escape char itself, so a literal domain
 * suffix can safely be used as a LIKE pattern (e.g. `mangakakalot.gg` stays literal). */
function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function defaultSupportBase(): string {
  return join(homedir(), "Library", "Application Support");
}

/**
 * Lists profile directory names (e.g. "Default", "Profile 1") under a browser's support dir.
 * `supportBase` defaults to `~/Library/Application Support` — overridable in tests only.
 */
export function listProfiles(supportDirName: string, supportBase = defaultSupportBase()): string[] {
  const base = join(supportBase, supportDirName);
  if (!existsSync(base)) return [];
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name === "Default" || name.startsWith("Profile "));
  } catch {
    return [];
  }
}

/**
 * Copies the live (possibly locked) `Cookies` DB for a profile to a fresh temp file.
 * Tries `<profile>/Cookies` first, then `<profile>/Network/Cookies` (newer Chromium layout).
 * Returns undefined when neither exists. `supportBase` overridable in tests only.
 */
export function copyCookieDb(
  supportDirName: string,
  profile: string,
  supportBase = defaultSupportBase(),
): string | undefined {
  const profileDir = join(supportBase, supportDirName, profile);
  const candidates = [join(profileDir, "Cookies"), join(profileDir, "Network", "Cookies")];
  const source = candidates.find((path) => existsSync(path));
  if (!source) return undefined;

  const tmpDir = mkdtempSync(join(tmpdir(), "scanldr-cookies-"));
  const dest = join(tmpDir, "Cookies");
  copyFileSync(source, dest);
  return dest;
}

/**
 * Queries `cookies` rows whose `host_key` is the given base domain or a subdomain of it
 * (exact-domain-or-subdomain match — never a bare substring, so lookalike/attacker domains
 * like "notmangakakalot.evil.com" can never match a `domainFilter` of "mangakakalot.gg").
 */
export function queryCookies(dbPath: string, domainFilter: string): CookieRow[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .query(
        "SELECT host_key, name, encrypted_value, creation_utc, expires_utc FROM cookies WHERE host_key = ? OR host_key = ? OR host_key LIKE ? ESCAPE '\\'",
      )
      .all(domainFilter, `.${domainFilter}`, `%.${escapeLikePattern(domainFilter)}`) as Array<{
      host_key: string;
      name: string;
      encrypted_value: Uint8Array;
      creation_utc: number;
      expires_utc: number;
    }>;

    return rows.map((r) => ({
      hostKey: r.host_key,
      name: r.name,
      encryptedValue: r.encrypted_value,
      creationUtc: r.creation_utc,
      expiresUtc: r.expires_utc,
    }));
  } finally {
    db.close();
  }
}

/** Best-effort delete of the temp cookie-DB copy (and its containing temp dir). Never throws. */
export function removeTempFile(path: string): void {
  try {
    rmSync(join(path, ".."), { recursive: true, force: true });
  } catch {
    // best-effort cleanup — ignore
  }
}

/** Reads `CFBundleShortVersionString` from an app bundle's Info.plist (text-search, no plist dep). */
export function readAppVersion(appBundlePath: string): string | undefined {
  const plistPath = join(appBundlePath, "Contents", "Info.plist");
  if (!existsSync(plistPath)) return undefined;
  try {
    const xml = readFileSync(plistPath, "utf8");
    const match = xml.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/** Whether the given browser's `.app` bundle is present on disk. */
export function isBrowserInstalled(def: ChromiumBrowserDef): boolean {
  try {
    return statSync(def.appBundlePath).isDirectory();
  } catch {
    return false;
  }
}
