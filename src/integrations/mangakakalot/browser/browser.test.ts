import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthError, pageHasRealContent, resolveAuthPath } from "./index.ts";
import type { RunAuthOptions } from "./types.ts";

// ---------------------------------------------------------------------------
// pageHasRealContent — CF challenge detection
// ---------------------------------------------------------------------------

describe("pageHasRealContent", () => {
  test("returns true when title contains MangaKakalot (no challenge shown)", async () => {
    expect(await pageHasRealContent("MangaKakalot - Read Manga Online")).toBe(true);
  });

  test("returns true for exact marker", async () => {
    expect(await pageHasRealContent("MangaKakalot")).toBe(true);
  });

  test("returns false when title is a Cloudflare challenge page", async () => {
    expect(await pageHasRealContent("Just a moment...")).toBe(false);
  });

  test("returns false when title is empty (CF blocked before HTML loads)", async () => {
    expect(await pageHasRealContent("")).toBe(false);
  });

  test("returns false when title is unrelated", async () => {
    expect(await pageHasRealContent("Attention Required! | Cloudflare")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AuthError shape
// ---------------------------------------------------------------------------

describe("AuthError", () => {
  test("is an Error subclass", () => {
    const err = new AuthError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AuthError);
  });

  test("preserves the message", () => {
    const err = new AuthError("session verification failed");
    expect(err.message).toBe("session verification failed");
  });

  test("name is AuthError (used by exitCode dispatch in src/index.ts)", () => {
    expect(new AuthError("x").name).toBe("AuthError");
  });
});

// ---------------------------------------------------------------------------
// resolveAuthPath — XDG layout
// ---------------------------------------------------------------------------

const noopLogger: RunAuthOptions["logger"] = {
  error: () => {},
  warn: () => {},
  info: () => {},
};

describe("resolveAuthPath", () => {
  test("uses explicit dataHome when provided", () => {
    const p = resolveAuthPath({
      logger: noopLogger,
      dataHome: "/tmp/explicit-data",
    });
    expect(p).toBe(join("/tmp/explicit-data", "scanldr", "auth.json"));
  });

  test("dataHome wins over $XDG_DATA_HOME and home", () => {
    const p = resolveAuthPath({
      logger: noopLogger,
      dataHome: "/tmp/explicit",
      env: { XDG_DATA_HOME: "/tmp/xdg" } as NodeJS.ProcessEnv,
      home: "/tmp/home",
    });
    expect(p).toBe(join("/tmp/explicit", "scanldr", "auth.json"));
  });

  test("falls back to $XDG_DATA_HOME when set", () => {
    const p = resolveAuthPath({
      logger: noopLogger,
      env: { XDG_DATA_HOME: "/tmp/xdg" } as NodeJS.ProcessEnv,
      home: "/tmp/ignored-home",
    });
    expect(p).toBe(join("/tmp/xdg", "scanldr", "auth.json"));
  });

  test("falls back to home/.local/share when XDG_DATA_HOME is empty", () => {
    const p = resolveAuthPath({
      logger: noopLogger,
      env: { XDG_DATA_HOME: "" } as NodeJS.ProcessEnv,
      home: "/tmp/home",
    });
    expect(p).toBe(join("/tmp/home", ".local", "share", "scanldr", "auth.json"));
  });

  test("falls back to home/.local/share when XDG_DATA_HOME is unset", () => {
    const p = resolveAuthPath({
      logger: noopLogger,
      env: {} as NodeJS.ProcessEnv,
      home: "/tmp/home",
    });
    expect(p).toBe(join("/tmp/home", ".local", "share", "scanldr", "auth.json"));
  });

  test("never returns a path under cwd (security P2 — was previously CWD/.scanldr-auth.json)", () => {
    const p = resolveAuthPath({
      logger: noopLogger,
      env: {} as NodeJS.ProcessEnv,
      home: "/tmp/home",
    });
    expect(p.startsWith(process.cwd())).toBe(false);
  });

  test("filename is auth.json (not the legacy .scanldr-auth.json)", () => {
    const p = resolveAuthPath({
      logger: noopLogger,
      dataHome: "/tmp/d",
    });
    expect(p.endsWith("/scanldr/auth.json")).toBe(true);
    expect(p.includes(".scanldr-auth.json")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// On-disk perms — hand-write a session file the same way runAuth would,
// to assert mkdir + writeFile mode flags actually take effect on this FS.
// (We cannot exercise runAuth itself without launching Chromium.)
// ---------------------------------------------------------------------------

describe("session persistence (mode 0600 + atomic write)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scanldr-auth-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("writeFile with mode 0o600 produces a 0600 file", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const path = resolveAuthPath({ logger: noopLogger, dataHome: tmpDir });
    const dir = path.substring(0, path.lastIndexOf("/"));

    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify({ cookies: {}, userAgent: "x", savedAt: 1 }), {
      encoding: "utf8",
      mode: 0o600,
    });

    const st = await stat(path);
    // mask out file-type bits, keep permission bits
    const perms = st.mode & 0o777;
    expect(perms).toBe(0o600);

    // and the JSON is parseable
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { userAgent: string };
    expect(parsed.userAgent).toBe("x");
  });
});
