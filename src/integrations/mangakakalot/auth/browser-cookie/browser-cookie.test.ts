import { describe, expect, test } from "bun:test";
import { createCipheriv } from "node:crypto";
import { CHROMIUM_BROWSERS } from "./browsers.ts";
import { deriveKey } from "./decrypt.ts";
import { extractBrowserSession } from "./index.ts";
import type { BrowserCookieDeps, CookieRow } from "./types.ts";

const IV = Buffer.alloc(16, 0x20);
const FIXTURE_PASSWORD = "fixture-password";

function encryptV10(plaintext: string): Uint8Array {
  const key = deriveKey(FIXTURE_PASSWORD);
  const cipher = createCipheriv("aes-128-cbc", key, IV);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("v10", "ascii"), encrypted]);
}

function cfClearanceRow(value: string, creationUtc: number): CookieRow {
  return {
    hostKey: ".mangakakalot.gg",
    name: "cf_clearance",
    encryptedValue: encryptV10(value),
    creationUtc,
    expiresUtc: creationUtc + 1_000_000,
  };
}

/** Builds fake deps backed by an in-memory profile→rows map. Never touches real fs/Keychain. */
function fakeDeps(
  profileRows: Record<string, CookieRow[]>,
  opts?: { installed?: boolean },
): {
  deps: BrowserCookieDeps;
  removedPaths: string[];
} {
  const removedPaths: string[] = [];
  const deps: BrowserCookieDeps = {
    readKeychainPassword: async () => FIXTURE_PASSWORD,
    listProfiles: () => Object.keys(profileRows),
    copyCookieDb: (_supportDir, profile) =>
      profile in profileRows ? `/tmp/fake/${profile}` : undefined,
    queryCookies: (dbPath) => {
      const profile = dbPath.split("/").pop() ?? "";
      return profileRows[profile] ?? [];
    },
    removeTempFile: (path) => {
      removedPaths.push(path);
    },
    readAppVersion: () => "126.0.6478.127",
    isBrowserInstalled: () => opts?.installed ?? true,
  };
  return { deps, removedPaths };
}

describe("extractBrowserSession", () => {
  test("returns undefined when the browser isn't installed", async () => {
    const { deps } = fakeDeps({ Default: [cfClearanceRow("token", 100)] }, { installed: false });
    const result = await extractBrowserSession(
      { browser: "opera", domainFilter: "mangakakalot.gg", deps },
      CHROMIUM_BROWSERS.opera,
    );
    expect(result).toBeUndefined();
  });

  test("returns undefined when no profile has a cookie store", async () => {
    const deps: BrowserCookieDeps = {
      readKeychainPassword: async () => FIXTURE_PASSWORD,
      listProfiles: () => ["Default"],
      copyCookieDb: () => undefined,
      queryCookies: () => [],
      removeTempFile: () => {},
      readAppVersion: () => "1.0.0",
      isBrowserInstalled: () => true,
    };
    const result = await extractBrowserSession(
      { browser: "chrome", domainFilter: "mangakakalot.gg", deps },
      CHROMIUM_BROWSERS.chrome,
    );
    expect(result).toBeUndefined();
  });

  test("returns undefined when no profile has cf_clearance for the domain", async () => {
    const { deps } = fakeDeps({ Default: [] });
    const result = await extractBrowserSession(
      { browser: "chrome", domainFilter: "mangakakalot.gg", deps },
      CHROMIUM_BROWSERS.chrome,
    );
    expect(result).toBeUndefined();
  });

  test("picks the freshest profile, decrypts cf_clearance, derives UA, cleans up temp files", async () => {
    const { deps, removedPaths } = fakeDeps({
      Default: [cfClearanceRow("stale-token", 100)],
      "Profile 1": [cfClearanceRow("fresh-token", 500)],
    });

    const result = await extractBrowserSession(
      { browser: "chrome", domainFilter: "mangakakalot.gg", deps },
      CHROMIUM_BROWSERS.chrome,
    );

    expect(result).toBeDefined();
    expect(result?.profile).toBe("Profile 1");
    expect(result?.cookies.cf_clearance).toBe("fresh-token");
    expect(result?.userAgent).toContain("Chrome/126.0.6478.127");
    expect(result?.browser).toBe("chrome");
    // temp DB for every profile queried gets cleaned up
    expect(removedPaths).toHaveLength(2);
  });
});
