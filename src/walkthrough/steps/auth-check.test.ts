import { describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudflareError } from "../../integrations/fallback-http/types.ts";
import { createLogger } from "../../plugins/logger/index.ts";
import type {
  BrowserCaptureDeps,
  SessionProbeClient,
  SessionProbeClientFactory,
} from "../types.ts";

const noop = () => {};
const logger = createLogger({ level: "info", format: "human", write: noop });

/** Build a fake probe client from a sequence of response factories. */
function fakeProbeSequence(responses: Array<() => Promise<Response>>): SessionProbeClientFactory {
  let idx = 0;
  const client: SessionProbeClient = {
    get: async (_url: string) => {
      const factory = responses[idx++];
      if (!factory) throw new Error("fakeProbeSequence exhausted");
      return factory();
    },
  };
  return async () => client;
}

/** 200 with real-looking HTML — session is valid. */
function okResponse(): Promise<Response> {
  return Promise.resolve(
    new Response("<html><body>Manga list</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  );
}

/** 403 — triggers CloudflareError in the probe. */
function cfRejectionResponse(): Promise<Response> {
  // The probe client's get() throws CloudflareError on 403, but our fake returns the
  // response directly (the real service.ts interprets 403 and throws).
  // We simulate the service behavior: throw a real CloudflareError.
  return Promise.reject(new CloudflareError("https://example.com"));
}

/** 500 response. */
function serverErrorResponse(): Promise<Response> {
  return Promise.resolve(new Response("Internal Server Error", { status: 500 }));
}

/** Network error (connection refused). */
function networkError(): Promise<Response> {
  return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:80"));
}

/** Valid cURL paste string. */
const VALID_CURL = "curl 'https://example.com' -H 'Cookie: cf_clearance=abc; session=xyz'";

describe("checkAuth", () => {
  test("requiresAuth: false → returns { ok: true, skipped: true } without prompting", async () => {
    let promptCalled = false;
    mock.module("../prompts.ts", () => ({
      editor: async () => {
        promptCalled = true;
        return "";
      },
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));
    const { checkAuth } = await import("./auth-check.ts");
    const result = await checkAuth({ requiresAuth: false, logger });
    expect(result).toEqual({ ok: true, skipped: true });
    expect(promptCalled).toBe(false);
  });

  test("requiresAuth: true with existing valid auth → returns { ok: true, skipped: false } without prompting (no probe)", async () => {
    const dir = join(tmpdir(), `scanldr-test-${Date.now()}`);
    const authDir = join(dir, "scanldr");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(join(authDir, "auth.json"), JSON.stringify({ token: "abc" }));

    let promptCalled = false;
    mock.module("../prompts.ts", () => ({
      editor: async () => {
        promptCalled = true;
        return "";
      },
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));

    const { checkAuth } = await import("./auth-check.ts");
    const result = await checkAuth({ requiresAuth: true, logger, dataHome: dir });
    expect(result).toEqual({ ok: true, skipped: false });
    expect(promptCalled).toBe(false);
  });

  test("requiresAuth: true, no auth file, valid cURL paste → returns { ok: true, skipped: false, justAuthenticated: true }", async () => {
    const tmpDir = join(tmpdir(), `scanldr-auth-test-${Date.now()}`);
    mock.module("../prompts.ts", () => ({
      editor: async () => VALID_CURL,
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));

    const { checkAuth } = await import("./auth-check.ts");
    const result = await checkAuth({ requiresAuth: true, logger, dataHome: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.justAuthenticated).toBe(true);
  });

  test("requiresAuth: true, invalid paste (no cookies) — exhausts 2 retries then throws WalkthroughError", async () => {
    let callCount = 0;
    mock.module("../prompts.ts", () => ({
      editor: async () => {
        callCount++;
        return "curl 'https://example.com' -H 'Accept: */*'"; // no cookie header
      },
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));

    const { checkAuth } = await import("./auth-check.ts");
    await expect(
      checkAuth({ requiresAuth: true, logger, dataHome: "/nonexistent/path" }),
    ).rejects.toThrow(/attempt/i);
    expect(callCount).toBe(2);
  });

  // --- Probe tests ---

  test("probe success: valid session → returns { ok: true, skipped: false }; NO cURL prompt shown", async () => {
    const dir = join(tmpdir(), `scanldr-probe-ok-${Date.now()}`);
    const authDir = join(dir, "scanldr");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      join(authDir, "auth.json"),
      JSON.stringify({ cookies: { cf_clearance: "x" }, userAgent: "ua", savedAt: Date.now() }),
    );

    let promptCalled = false;
    mock.module("../prompts.ts", () => ({
      editor: async () => {
        promptCalled = true;
        return "";
      },
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));

    const { checkAuth } = await import("./auth-check.ts");
    const result = await checkAuth({
      requiresAuth: true,
      logger,
      dataHome: dir,
      probeClientFactory: fakeProbeSequence([okResponse]),
    });

    expect(result).toEqual({ ok: true, skipped: false });
    expect(promptCalled).toBe(false);
  });

  test("probe stale → re-prompt → persist → re-probe ok → returns { ok: true, refreshed: true }", async () => {
    const dir = join(tmpdir(), `scanldr-probe-stale-${Date.now()}`);
    const authDir = join(dir, "scanldr");
    mkdirSync(authDir, { recursive: true });
    const authJsonPath = join(authDir, "auth.json");
    writeFileSync(
      authJsonPath,
      JSON.stringify({ cookies: { cf_clearance: "old" }, userAgent: "ua", savedAt: Date.now() }),
    );

    let promptCount = 0;
    mock.module("../prompts.ts", () => ({
      editor: async () => {
        promptCount++;
        return VALID_CURL;
      },
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));

    // First probe: CF rejection. Second probe (after paste): ok.
    const probeClientFactory = fakeProbeSequence([cfRejectionResponse, okResponse]);

    const { checkAuth } = await import("./auth-check.ts");
    const result = await checkAuth({
      requiresAuth: true,
      logger,
      dataHome: dir,
      probeClientFactory,
    });

    expect(result).toEqual({ ok: true, skipped: false, refreshed: true });
    expect(promptCount).toBe(1);
    // auth.json was deleted then re-written — must still exist with new content
    expect(existsSync(authJsonPath)).toBe(true);
    const written = JSON.parse(readFileSync(authJsonPath, "utf-8")) as {
      cookies: Record<string, string>;
    };
    expect(written.cookies).toHaveProperty("cf_clearance", "abc");
  });

  test("refresh does not delete auth.json before a successful paste", async () => {
    const dir = join(tmpdir(), `scanldr-refresh-no-upfront-unlink-${Date.now()}`);
    const authDir = join(dir, "scanldr");
    mkdirSync(authDir, { recursive: true });
    const authJsonPath = join(authDir, "auth.json");
    writeFileSync(
      authJsonPath,
      JSON.stringify({ cookies: { cf_clearance: "old" }, userAgent: "ua", savedAt: Date.now() }),
    );

    // Confirms the file is still present when the editor prompt runs — i.e. no upfront
    // unlink before the paste succeeds (persistSession overwrites atomically instead).
    let existedAtPromptTime = false;
    mock.module("../prompts.ts", () => ({
      editor: async () => {
        existedAtPromptTime = existsSync(authJsonPath);
        return VALID_CURL;
      },
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));

    const probeClientFactory = fakeProbeSequence([cfRejectionResponse, okResponse]);

    const { checkAuth } = await import("./auth-check.ts");
    const result = await checkAuth({
      requiresAuth: true,
      logger,
      dataHome: dir,
      probeClientFactory,
    });

    expect(existedAtPromptTime).toBe(true);
    expect(result).toEqual({ ok: true, skipped: false, refreshed: true });
    expect(existsSync(authJsonPath)).toBe(true);
  });

  test("probe stale → re-prompt → re-probe stale again → throws WalkthroughError", async () => {
    const dir = join(tmpdir(), `scanldr-probe-stale-twice-${Date.now()}`);
    const authDir = join(dir, "scanldr");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      join(authDir, "auth.json"),
      JSON.stringify({ cookies: { cf_clearance: "old" }, userAgent: "ua", savedAt: Date.now() }),
    );

    mock.module("../prompts.ts", () => ({
      editor: async () => VALID_CURL,
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));

    const probeClientFactory = fakeProbeSequence([cfRejectionResponse, cfRejectionResponse]);

    const { checkAuth } = await import("./auth-check.ts");
    await expect(
      checkAuth({ requiresAuth: true, logger, dataHome: dir, probeClientFactory }),
    ).rejects.toThrow(/Session refresh failed twice/);
  });

  test("probe network error → throws WalkthroughError; auth.json is NOT deleted", async () => {
    const dir = join(tmpdir(), `scanldr-probe-net-${Date.now()}`);
    const authDir = join(dir, "scanldr");
    mkdirSync(authDir, { recursive: true });
    const authJsonPath = join(authDir, "auth.json");
    writeFileSync(
      authJsonPath,
      JSON.stringify({ cookies: { cf_clearance: "x" }, userAgent: "ua", savedAt: Date.now() }),
    );

    mock.module("../prompts.ts", () => ({
      editor: async () => VALID_CURL,
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));

    const probeClientFactory = fakeProbeSequence([networkError]);

    const { checkAuth } = await import("./auth-check.ts");
    await expect(
      checkAuth({ requiresAuth: true, logger, dataHome: dir, probeClientFactory }),
    ).rejects.toThrow(/Could not reach Mangakakalot/);

    // auth.json must still be intact
    expect(existsSync(authJsonPath)).toBe(true);
  });

  test("probe 5xx → throws WalkthroughError; auth.json is NOT deleted", async () => {
    const dir = join(tmpdir(), `scanldr-probe-5xx-${Date.now()}`);
    const authDir = join(dir, "scanldr");
    mkdirSync(authDir, { recursive: true });
    const authJsonPath = join(authDir, "auth.json");
    writeFileSync(
      authJsonPath,
      JSON.stringify({ cookies: { cf_clearance: "x" }, userAgent: "ua", savedAt: Date.now() }),
    );

    mock.module("../prompts.ts", () => ({
      editor: async () => VALID_CURL,
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));

    const probeClientFactory = fakeProbeSequence([serverErrorResponse]);

    const { checkAuth } = await import("./auth-check.ts");
    await expect(
      checkAuth({ requiresAuth: true, logger, dataHome: dir, probeClientFactory }),
    ).rejects.toThrow(/unexpected status \(500\)/);

    expect(existsSync(authJsonPath)).toBe(true);
  });

  test("first-run (no auth.json): paste → persist → probe ok → returns { ok: true, justAuthenticated: true }", async () => {
    const dir = join(tmpdir(), `scanldr-fresh-probe-${Date.now()}`);

    mock.module("../prompts.ts", () => ({
      editor: async () => VALID_CURL,
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));

    const probeClientFactory = fakeProbeSequence([okResponse]);

    const { checkAuth } = await import("./auth-check.ts");
    const result = await checkAuth({
      requiresAuth: true,
      logger,
      dataHome: dir,
      probeClientFactory,
    });

    expect(result).toEqual({ ok: true, skipped: false, justAuthenticated: true });
  });

  test("probe URL contains /search/story/ (representative CF detection — not the homepage)", async () => {
    const dir = join(tmpdir(), `scanldr-probe-url-${Date.now()}`);
    const authDir = join(dir, "scanldr");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      join(authDir, "auth.json"),
      JSON.stringify({ cookies: { cf_clearance: "x" }, userAgent: "ua", savedAt: Date.now() }),
    );

    mock.module("../prompts.ts", () => ({
      editor: async () => "",
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));

    let capturedUrl = "";
    const client: SessionProbeClient = {
      get: async (url: string) => {
        capturedUrl = url;
        return okResponse();
      },
    };
    const probeClientFactory: SessionProbeClientFactory = async () => client;

    const { checkAuth } = await import("./auth-check.ts");
    await checkAuth({ requiresAuth: true, logger, dataHome: dir, probeClientFactory });

    expect(capturedUrl).toContain("/search/story/");
  });

  describe("browser capture JIT", () => {
    function fakeBrowserCapture(overrides: Partial<BrowserCaptureDeps> = {}) {
      const calls = { launch: 0 };
      const deps: BrowserCaptureDeps = {
        launcherDeps: {
          launch: async () => {
            calls.launch++;
            return {
              goto: async () => {},
              waitForChallengeCleared: async () => {},
              cookies: async () => [
                { name: "cf_clearance", value: "captured-cf-token" },
                { name: "other", value: "captured-other" },
              ],
              userAgent: async () => "Mozilla/5.0 captured-ua",
              close: async () => {},
            };
          },
        },
        ...overrides,
      };
      return { deps, calls };
    }

    test("browser capture succeeds and probe validates → persists WITHOUT prompting for manual paste", async () => {
      const dir = join(tmpdir(), `scanldr-capture-ok-${Date.now()}`);
      let editorCalled = false;
      mock.module("../prompts.ts", () => ({
        editor: async () => {
          editorCalled = true;
          return VALID_CURL;
        },
        input: async () => "",
        select: async () => "",
        checkbox: async () => [],
        confirm: async () => false,
      }));

      // Initial valid auth.json present, but stale (needs refresh)
      mkdirSync(join(dir, "scanldr"), { recursive: true });
      writeFileSync(
        join(dir, "scanldr", "auth.json"),
        JSON.stringify({ cookies: { cf_clearance: "old" }, userAgent: "old-ua" }),
      );

      const { deps, calls } = fakeBrowserCapture();
      const candidateFetch = async () => new Response("ok", { status: 200 });

      const { checkAuth } = await import("./auth-check.ts");
      const result = await checkAuth({
        requiresAuth: true,
        logger,
        dataHome: dir,
        // First probe yields stale, re-probe after capture yields ok
        probeClientFactory: fakeProbeSequence([cfRejectionResponse, okResponse]),
        browserCapture: deps,
        fetch: candidateFetch,
      });

      expect(editorCalled).toBe(false);
      expect(result.ok).toBe(true);
      expect(result.refreshed).toBe(true);
      // Regression guard (issue #208 P2): capture must happen EXACTLY once per
      // stale-session refresh — no duplicate explicit-capture + refreshSession launch.
      expect(calls.launch).toBe(1);

      const authJson = JSON.parse(readFileSync(join(dir, "scanldr", "auth.json"), "utf-8")) as {
        cookies: Record<string, string>;
        userAgent: string;
      };
      expect(authJson.cookies.cf_clearance).toBe("captured-cf-token");
      expect(authJson.userAgent).toBe("Mozilla/5.0 captured-ua");
    });

    test("browser capture's inner probe rejects the captured session → falls back to manual paste WITHOUT launching the browser a second time", async () => {
      const dir = join(tmpdir(), `scanldr-capture-single-solve-${Date.now()}`);
      let editorCalled = false;
      mock.module("../prompts.ts", () => ({
        editor: async () => {
          editorCalled = true;
          return VALID_CURL;
        },
        input: async () => "",
        select: async () => "",
        checkbox: async () => [],
        confirm: async () => false,
      }));

      mkdirSync(join(dir, "scanldr"), { recursive: true });
      writeFileSync(
        join(dir, "scanldr", "auth.json"),
        JSON.stringify({ cookies: { cf_clearance: "old" }, userAgent: "old-ua" }),
      );

      const { deps, calls } = fakeBrowserCapture();
      // Candidate probe (inside tryCaptureViaBrowser) rejects the captured session —
      // capture is discarded and promptAndParseSession falls through to manual paste
      // WITHOUT ever launching the browser a second time (regression guard for #208 P2).
      const candidateFetch = async () => new Response("forbidden", { status: 403 });

      const { checkAuth } = await import("./auth-check.ts");
      const result = await checkAuth({
        requiresAuth: true,
        logger,
        dataHome: dir,
        probeClientFactory: fakeProbeSequence([cfRejectionResponse, okResponse]),
        browserCapture: deps,
        fetch: candidateFetch,
      });

      expect(calls.launch).toBe(1);
      expect(editorCalled).toBe(true);
      expect(result.ok).toBe(true);

      const authJson = JSON.parse(readFileSync(join(dir, "scanldr", "auth.json"), "utf-8")) as {
        cookies: Record<string, string>;
      };
      expect(authJson.cookies.cf_clearance).toBe("abc");
    });

    test("browser capture fails or probe fails → falls back to manual paste", async () => {
      const dir = join(tmpdir(), `scanldr-capture-fail-${Date.now()}`);
      let editorCalled = false;
      mock.module("../prompts.ts", () => ({
        editor: async () => {
          editorCalled = true;
          return VALID_CURL;
        },
        input: async () => "",
        select: async () => "",
        checkbox: async () => [],
        confirm: async () => false,
      }));

      // Initial valid auth.json present, but stale (needs refresh)
      mkdirSync(join(dir, "scanldr"), { recursive: true });
      writeFileSync(
        join(dir, "scanldr", "auth.json"),
        JSON.stringify({ cookies: { cf_clearance: "old" }, userAgent: "old-ua" }),
      );

      // launcher returns undefined (e.g. Chrome not installed)
      const deps: BrowserCaptureDeps = {
        launcherDeps: {
          launch: async () => undefined,
        },
      };

      const { checkAuth } = await import("./auth-check.ts");
      const result = await checkAuth({
        requiresAuth: true,
        logger,
        dataHome: dir,
        probeClientFactory: fakeProbeSequence([cfRejectionResponse, okResponse]),
        browserCapture: deps,
      });

      expect(editorCalled).toBe(true);
      expect(result.ok).toBe(true);

      const authJson = JSON.parse(readFileSync(join(dir, "scanldr", "auth.json"), "utf-8")) as {
        cookies: Record<string, string>;
      };
      expect(authJson.cookies.cf_clearance).toBe("abc"); // VALID_CURL's clearance
    });
  });
});
