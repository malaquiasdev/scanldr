import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  copyCookieDb,
  isBrowserInstalled,
  listProfiles,
  queryCookies,
  readAppVersion,
  removeTempFile,
} from "./store.ts";
import type { ChromiumBrowserDef } from "./types.ts";

function makeCookieDb(path: string): void {
  const db = new Database(path, { create: true });
  db.run(`
    CREATE TABLE cookies (
      host_key TEXT,
      name TEXT,
      encrypted_value BLOB,
      creation_utc INTEGER,
      expires_utc INTEGER
    )
  `);
  db.run(
    "INSERT INTO cookies (host_key, name, encrypted_value, creation_utc, expires_utc) VALUES (?, ?, ?, ?, ?)",
    [".mangakakalot.gg", "cf_clearance", Buffer.from("v10encryptedbytes"), 100, 200],
  );
  db.run(
    "INSERT INTO cookies (host_key, name, encrypted_value, creation_utc, expires_utc) VALUES (?, ?, ?, ?, ?)",
    [".unrelated.com", "session", Buffer.from("v10other"), 50, 60],
  );
  db.run(
    "INSERT INTO cookies (host_key, name, encrypted_value, creation_utc, expires_utc) VALUES (?, ?, ?, ?, ?)",
    [".notmangakakalot.evil.com", "cf_clearance", Buffer.from("v10evil"), 999, 1999],
  );
  db.close();
}

describe("queryCookies", () => {
  test("filters rows by exact-domain-or-subdomain match and maps snake_case → camelCase", () => {
    const dir = mkdtempSync(join(tmpdir(), "scanldr-store-test-"));
    const dbPath = join(dir, "Cookies");
    makeCookieDb(dbPath);

    const rows = queryCookies(dbPath, "mangakakalot.gg");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hostKey).toBe(".mangakakalot.gg");
    expect(rows[0]?.name).toBe("cf_clearance");
    expect(rows[0]?.creationUtc).toBe(100);

    rmSync(dir, { recursive: true, force: true });
  });

  test("does NOT match a lookalike/attacker domain that merely contains the substring", () => {
    const dir = mkdtempSync(join(tmpdir(), "scanldr-store-lookalike-test-"));
    const dbPath = join(dir, "Cookies");
    makeCookieDb(dbPath);

    const rows = queryCookies(dbPath, "mangakakalot.gg");
    expect(rows.some((r) => r.hostKey === ".notmangakakalot.evil.com")).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("listProfiles", () => {
  test("returns Default + Profile N dirs, ignores other files/dirs", () => {
    const base = mkdtempSync(join(tmpdir(), "scanldr-profiles-test-"));
    const supportDir = join(base, "FakeBrowser");
    mkdirSync(join(supportDir, "Default"), { recursive: true });
    mkdirSync(join(supportDir, "Profile 1"), { recursive: true });
    mkdirSync(join(supportDir, "System Profile"), { recursive: true });
    writeFileSync(join(supportDir, "Local State"), "{}");

    const profiles = listProfiles("FakeBrowser", base);
    expect(profiles.sort()).toEqual(["Default", "Profile 1"]);

    rmSync(base, { recursive: true, force: true });
  });

  test("returns empty array when the support dir doesn't exist", () => {
    expect(listProfiles("NoSuchBrowser", "/nonexistent/base")).toEqual([]);
  });
});

describe("copyCookieDb / removeTempFile", () => {
  test("copies <profile>/Cookies to a temp path and it can be removed", () => {
    const base = mkdtempSync(join(tmpdir(), "scanldr-copy-test-"));
    const profileDir = join(base, "FakeBrowser", "Default");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "Cookies"), "fake-sqlite-bytes");

    const copied = copyCookieDb("FakeBrowser", "Default", base);
    expect(copied).toBeDefined();
    expect(existsSync(copied as string)).toBe(true);

    removeTempFile(copied as string);
    expect(existsSync(copied as string)).toBe(false);

    rmSync(base, { recursive: true, force: true });
  });

  test("falls back to <profile>/Network/Cookies when top-level Cookies is absent", () => {
    const base = mkdtempSync(join(tmpdir(), "scanldr-copy-network-test-"));
    const networkDir = join(base, "FakeBrowser", "Default", "Network");
    mkdirSync(networkDir, { recursive: true });
    writeFileSync(join(networkDir, "Cookies"), "fake-sqlite-bytes");

    const copied = copyCookieDb("FakeBrowser", "Default", base);
    expect(copied).toBeDefined();

    rmSync(base, { recursive: true, force: true });
  });

  test("returns undefined when neither Cookies nor Network/Cookies exists", () => {
    const base = mkdtempSync(join(tmpdir(), "scanldr-copy-missing-test-"));
    expect(copyCookieDb("FakeBrowser", "Default", base)).toBeUndefined();
    rmSync(base, { recursive: true, force: true });
  });
});

describe("readAppVersion", () => {
  test("parses CFBundleShortVersionString from a real Info.plist", () => {
    const dir = mkdtempSync(join(tmpdir(), "scanldr-plist-test-"));
    const contentsDir = join(dir, "Contents");
    mkdirSync(contentsDir, { recursive: true });
    writeFileSync(
      join(contentsDir, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>126.0.6478.127</string>
</dict>
</plist>`,
    );

    expect(readAppVersion(dir)).toBe("126.0.6478.127");
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns undefined when Info.plist is missing", () => {
    expect(readAppVersion("/nonexistent/App.app")).toBeUndefined();
  });
});

describe("isBrowserInstalled", () => {
  test("false for a bundle path that doesn't exist", () => {
    const def: ChromiumBrowserDef = {
      id: "chrome",
      label: "x",
      appName: "x",
      appBundlePath: "/nonexistent/Foo.app",
      supportDirName: "x",
      keychainService: "x",
    };
    expect(isBrowserInstalled(def)).toBe(false);
  });
});

test("removeTempFile is best-effort and never throws on a missing path", () => {
  expect(() => removeTempFile("/nonexistent/tmp/Cookies")).not.toThrow();
});
