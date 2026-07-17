// Types for the macOS/Chromium browser-cookie auto-extraction flow (issue #202).
// Scoped to macOS + Chromium-family browsers (Chrome, Opera, Brave, Edge) for the MVP.
// Firefox/Safari/Windows/Linux are explicit follow-ups (see docs/discovery/cf-cookie-autoextract-feasibility.md).

export type ChromiumBrowserId = "chrome" | "opera" | "brave" | "edge";

/** Static per-browser metadata needed to locate cookies, Keychain entry, and app version. */
export interface ChromiumBrowserDef {
  id: ChromiumBrowserId;
  /** Human label for prompts. */
  label: string;
  /** `open -a <appName>` target name. */
  appName: string;
  /** macOS `.app` bundle path, used to read `CFBundleShortVersionString` for UA derivation. */
  appBundlePath: string;
  /** Support directory holding profile folders, relative to `$HOME/Library/Application Support`. */
  supportDirName: string;
  /** macOS Keychain service name for the Safe Storage password ("security find-generic-password -s"). */
  keychainService: string;
}

/** One row read from a Chromium `Cookies` SQLite database. */
export interface CookieRow {
  hostKey: string;
  name: string;
  /** Raw encrypted_value bytes (v10-prefixed for Chromium's AES scheme). */
  encryptedValue: Uint8Array;
  creationUtc: number;
  expiresUtc: number;
}

/** Cookie rows read from one browser profile. */
export interface ProfileCookies {
  profile: string;
  rows: CookieRow[];
}

/** Shell/filesystem seams — mocked in tests, never hit the real Keychain/disk in test runs. */
export interface BrowserCookieDeps {
  /** Reads the Keychain "<Browser> Safe Storage" password. Shells out to `security`. */
  readKeychainPassword: (serviceName: string) => Promise<string>;
  /** Lists the profile directory names under a browser's support directory (e.g. "Default", "Profile 1"). */
  listProfiles: (supportDirName: string) => string[];
  /**
   * Copies the live (possibly locked) cookie DB for a profile to a temp path.
   * Tries `<profile>/Cookies` then `<profile>/Network/Cookies`. Returns undefined if neither exists.
   */
  copyCookieDb: (supportDirName: string, profile: string) => string | undefined;
  /** Queries `cookies` rows matching the domain filter from a (already-copied) SQLite file. */
  queryCookies: (dbPath: string, domainFilter: string) => CookieRow[];
  /** Best-effort delete of a temp file. Never throws. */
  removeTempFile: (path: string) => void;
  /** Reads `CFBundleShortVersionString` from an `Info.plist` inside an app bundle. */
  readAppVersion: (appBundlePath: string) => string | undefined;
  /** Whether the given browser's `.app` bundle is present on disk. */
  isBrowserInstalled: (def: ChromiumBrowserDef) => boolean;
}

export interface ExtractBrowserSessionOptions {
  browser: ChromiumBrowserId;
  /** e.g. "mangakakalot.gg" — base domain; matches host_key exactly or as a subdomain (never a bare substring). */
  domainFilter: string;
  deps: BrowserCookieDeps;
}

export interface ExtractedBrowserSession {
  /** All cf_* cookies found for the domain, decrypted. Always includes cf_clearance when present. */
  cookies: Record<string, string>;
  /**
   * Exact UA derived from the browser (Chrome only — its app version IS the Chromium
   * version). Undefined for non-Chrome browsers (issue #205) — the caller must prompt
   * the human to paste their exact UA in that case.
   */
  userAgent: string | undefined;
  browser: ChromiumBrowserId;
  profile: string;
}
