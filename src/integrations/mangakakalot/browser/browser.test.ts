import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAuthPath } from "@plugins/auth-path/index.ts";
import { AuthError, buildVerifyHeaders, pageHasRealContent, pollForClearance } from "./index.ts";
import type { CookieLike } from "./types.ts";

// ---------------------------------------------------------------------------
// pageHasRealContent — CF challenge detection
// ---------------------------------------------------------------------------

describe("pageHasRealContent", () => {
  test("returns true when title contains MangaKakalot (no challenge shown)", () => {
    expect(pageHasRealContent("MangaKakalot - Read Manga Online")).toBe(true);
  });

  test("returns true for exact marker", () => {
    expect(pageHasRealContent("MangaKakalot")).toBe(true);
  });

  test("returns false when title is a Cloudflare challenge page", () => {
    expect(pageHasRealContent("Just a moment...")).toBe(false);
  });

  test("returns false when title is empty (CF blocked before HTML loads)", () => {
    expect(pageHasRealContent("")).toBe(false);
  });

  test("returns false when title is unrelated", () => {
    expect(pageHasRealContent("Attention Required! | Cloudflare")).toBe(false);
  });

  test("is not async (no unnecessary async)", () => {
    // pageHasRealContent must return a plain boolean, not a Promise.
    // If the return type were Promise<boolean>, `typeof result` would be "object".
    const result = pageHasRealContent("MangaKakalot");
    expect(result).toBe(true);
    expect(typeof result).toBe("boolean");
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

describe("resolveAuthPath", () => {
  test("uses explicit dataHome when provided", () => {
    const p = resolveAuthPath({ dataHome: "/tmp/explicit-data" });
    expect(p).toBe(join("/tmp/explicit-data", "scanldr", "auth.json"));
  });

  test("dataHome wins over $XDG_DATA_HOME and home", () => {
    const p = resolveAuthPath({
      dataHome: "/tmp/explicit",
      env: { XDG_DATA_HOME: "/tmp/xdg" } as NodeJS.ProcessEnv,
      home: "/tmp/home",
    });
    expect(p).toBe(join("/tmp/explicit", "scanldr", "auth.json"));
  });

  test("falls back to $XDG_DATA_HOME when set", () => {
    const p = resolveAuthPath({
      env: { XDG_DATA_HOME: "/tmp/xdg" } as NodeJS.ProcessEnv,
      home: "/tmp/ignored-home",
    });
    expect(p).toBe(join("/tmp/xdg", "scanldr", "auth.json"));
  });

  test("falls back to home/.local/share when XDG_DATA_HOME is empty", () => {
    const p = resolveAuthPath({
      env: { XDG_DATA_HOME: "" } as NodeJS.ProcessEnv,
      home: "/tmp/home",
    });
    expect(p).toBe(join("/tmp/home", ".local", "share", "scanldr", "auth.json"));
  });

  test("falls back to home/.local/share when XDG_DATA_HOME is unset", () => {
    const p = resolveAuthPath({
      env: {} as NodeJS.ProcessEnv,
      home: "/tmp/home",
    });
    expect(p).toBe(join("/tmp/home", ".local", "share", "scanldr", "auth.json"));
  });

  test("never returns a path under cwd (security P2 — was previously CWD/.scanldr-auth.json)", () => {
    const p = resolveAuthPath({ env: {} as NodeJS.ProcessEnv, home: "/tmp/home" });
    expect(p.startsWith(process.cwd())).toBe(false);
  });

  test("filename is auth.json (not the legacy .scanldr-auth.json)", () => {
    const p = resolveAuthPath({ dataHome: "/tmp/d" });
    expect(p.endsWith("/scanldr/auth.json")).toBe(true);
    expect(p.includes(".scanldr-auth.json")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pollForClearance — challenge poll helper
// ---------------------------------------------------------------------------

describe("pollForClearance", () => {
  test("resolves immediately when cf_clearance is present on first poll", async () => {
    const cookies: CookieLike[] = [{ name: "cf_clearance", value: "abc" }];
    await expect(
      pollForClearance({
        getCookies: async () => cookies,
        timeoutMs: 5_000,
        intervalMs: 10,
      }),
    ).resolves.toBeUndefined();
  });

  test("resolves after cookie appears on a later poll", async () => {
    let callCount = 0;
    const getCookies = async (): Promise<CookieLike[]> => {
      callCount++;
      // Return cf_clearance only on the 3rd call.
      if (callCount >= 3) return [{ name: "cf_clearance", value: "xyz" }];
      return [{ name: "other_cookie", value: "val" }];
    };

    await expect(
      pollForClearance({
        getCookies,
        timeoutMs: 5_000,
        intervalMs: 10,
      }),
    ).resolves.toBeUndefined();

    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  test("throws AuthError when cf_clearance never appears within timeout", async () => {
    const getCookies = async (): Promise<CookieLike[]> => [{ name: "unrelated", value: "val" }];

    await expect(
      pollForClearance({
        getCookies,
        timeoutMs: 50, // very short for test speed
        intervalMs: 10,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  test("timeout error message matches documented text", async () => {
    const getCookies = async (): Promise<CookieLike[]> => [];

    await expect(
      pollForClearance({
        getCookies,
        timeoutMs: 50,
        intervalMs: 10,
      }),
    ).rejects.toMatchObject({
      message: "Challenge not solved within timeout. No session saved.",
    });
  });

  test("propagates AuthError thrown by getCookies (e.g. browser closed)", async () => {
    const browserClosedError = new AuthError(
      "Browser closed before challenge was resolved. No session saved.",
    );
    const getCookies = async (): Promise<CookieLike[]> => {
      throw browserClosedError;
    };

    await expect(
      pollForClearance({
        getCookies,
        timeoutMs: 5_000,
        intervalMs: 10,
      }),
    ).rejects.toBe(browserClosedError);
  });
});

// ---------------------------------------------------------------------------
// buildVerifyHeaders — verify-fetch header construction
// ---------------------------------------------------------------------------

describe("buildVerifyHeaders", () => {
  test("omits Cookie header when cookies map is empty", () => {
    const headers = buildVerifyHeaders({}, "Mozilla/5.0");
    expect("cookie" in headers).toBe(false);
    expect(headers["user-agent"]).toBe("Mozilla/5.0");
  });

  test("includes Cookie header when cookies map is non-empty", () => {
    const headers = buildVerifyHeaders({ _ga: "GA1.1.123", cf_clearance: "abc" }, "Mozilla/5.0");
    expect(headers.cookie).toBeDefined();
    expect(headers.cookie).toContain("_ga=GA1.1.123");
    expect(headers.cookie).toContain("cf_clearance=abc");
    expect(headers["user-agent"]).toBe("Mozilla/5.0");
  });

  test("single cookie produces correct k=v format with no trailing separator", () => {
    const headers = buildVerifyHeaders({ token: "xyz" }, "ua");
    expect(headers.cookie).toBe("token=xyz");
  });

  test("multiple cookies are joined by '; '", () => {
    const headers = buildVerifyHeaders({ a: "1", b: "2" }, "ua");
    // Order depends on Object.entries — just verify both are present and separator exists
    expect(headers.cookie).toMatch(/a=1/);
    expect(headers.cookie).toMatch(/b=2/);
    expect(headers.cookie).toContain("; ");
  });
});

// ---------------------------------------------------------------------------
// runAuth — no-challenge path: waitForLoadState ordering
//
// These tests use a minimal Playwright-shaped mock. They cannot launch
// Chromium, so they only exercise the observable ordering of mock calls.
// ---------------------------------------------------------------------------

import { runAuth } from "./index.ts";
import type { RunAuthOptions } from "./types.ts";

describe("runAuth no-challenge path — waitForLoadState ordering", () => {
  // Build a minimal mock that simulates the no-challenge path.
  // Returns call log so tests can assert ordering.
  function buildMocks(opts: {
    cookiesAfterLoad?: Array<{ name: string; value: string }>;
    loadRejects?: boolean;
  }) {
    const callLog: string[] = [];
    const { cookiesAfterLoad = [{ name: "_ga", value: "GA1.1.1" }], loadRejects = false } = opts;

    let loadStateCalled = false;

    const page = {
      goto: async () => {},
      title: async () => "MangaKakalot - Read Manga Online",
      evaluate: async () => "Mozilla/5.0 (mock)",
      waitForLoadState: async (_state: string, _opts?: unknown) => {
        callLog.push("waitForLoadState");
        loadStateCalled = true;
        if (loadRejects) throw new Error("timeout");
      },
    };

    const context = {
      newPage: async () => page,
      cookies: async (_url?: string) => {
        callLog.push("cookies");
        // Return cookies only after waitForLoadState has been called — simulates
        // the real-world race where GA cookies appear after "load".
        return loadStateCalled ? cookiesAfterLoad : [];
      },
    };

    const browser = {
      on: (_event: string, _cb: () => void) => {},
      newContext: async () => context,
      close: async () => {},
    };

    return { browser, callLog };
  }

  // Patch chromium.launch so runAuth uses our mock browser.
  // We import "playwright" at the module level in index.ts, so we monkey-patch
  // the module object directly — Bun supports this for in-process mocking.
  async function withMockBrowser(browser: unknown, fn: () => Promise<void>): Promise<void> {
    const playwright = await import("playwright");
    const original = playwright.chromium.launch;
    // @ts-expect-error — intentional monkey-patch for test isolation
    playwright.chromium.launch = async () => browser;
    try {
      await fn();
    } finally {
      playwright.chromium.launch = original;
    }
  }

  function buildOpts(tmpDataHome: string): RunAuthOptions {
    return {
      dataHome: tmpDataHome,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        // pino minimal shape
        child: () => ({}) as never,
      } as unknown as RunAuthOptions["logger"],
    };
  }

  test("waitForLoadState('load') is called before context.cookies() on no-challenge path", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "scanldr-auth-order-"));
    try {
      const { browser, callLog } = buildMocks({});

      // Stub fetch to simulate a successful verify.
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => ({ ok: true }) as Response) as unknown as typeof fetch;

      try {
        await withMockBrowser(browser, () => runAuth(buildOpts(tmpDir)));
      } finally {
        globalThis.fetch = originalFetch;
      }

      const waitIdx = callLog.indexOf("waitForLoadState");
      const cookiesIdx = callLog.indexOf("cookies");
      expect(waitIdx).toBeGreaterThanOrEqual(0);
      expect(cookiesIdx).toBeGreaterThanOrEqual(0);
      expect(waitIdx).toBeLessThan(cookiesIdx);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("load timeout falls through: warn fires, cookies still extracted, session saved", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "scanldr-auth-timeout-"));
    const warnEvents: string[] = [];
    try {
      const { browser } = buildMocks({ loadRejects: true });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => ({ ok: true }) as Response) as unknown as typeof fetch;

      let warnFired = false;
      const opts: RunAuthOptions = {
        ...buildOpts(tmpDir),
        logger: {
          info: () => {},
          warn: (fields: Record<string, unknown>) => {
            if (fields.event === "auth.load_timeout") warnFired = true;
            warnEvents.push(String(fields.event));
          },
          error: () => {},
          debug: () => {},
          child: () => ({}) as never,
        } as unknown as RunAuthOptions["logger"],
      };

      try {
        await withMockBrowser(browser, () => runAuth(opts));
      } finally {
        globalThis.fetch = originalFetch;
      }

      expect(warnFired).toBe(true);
      // Session file should exist despite timeout.
      const sessionPath = resolveAuthPath({ dataHome: tmpDir });
      const raw = await readFile(sessionPath, "utf8");
      const parsed = JSON.parse(raw) as { userAgent: string };
      expect(parsed.userAgent).toBe("Mozilla/5.0 (mock)");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
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
    const path = resolveAuthPath({ dataHome: tmpDir });
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
