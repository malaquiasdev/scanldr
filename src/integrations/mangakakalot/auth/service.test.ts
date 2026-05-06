import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAuthPath } from "@plugins/auth-path/index.ts";
import { runAuth } from "./service.ts";
import { AuthError } from "./types.ts";
import type { RunAuthOptions } from "./types.ts";

const VALID_CURL = `curl 'https://www.mangakakalot.gg/search/story/dragon-ball' \
  -H 'cookie: cf_clearance=test_clearance; _ga=GA1.1.123' \
  -H 'user-agent: Mozilla/5.0 (test)'`;

function noop() {}

function buildLogger() {
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: () => ({}) as never,
  } as unknown as RunAuthOptions["logger"];
}

function buildFetch(status: number, body: string): RunAuthOptions["fetch"] {
  return async () =>
    ({
      status,
      ok: status >= 200 && status < 300,
      text: async () => body,
    }) as Response;
}

describe("runAuth — validation", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scanldr-auth-svc-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("throws AuthError when input is empty", async () => {
    const opts: RunAuthOptions = {
      logger: buildLogger(),
      dataHome: tmpDir,
      readStdin: async () => "",
      fetch: buildFetch(200, "ok"),
    };
    await expect(runAuth(opts)).rejects.toBeInstanceOf(AuthError);
  });

  test("throws AuthError when cf_clearance is absent", async () => {
    const curlNoClear = `curl 'https://www.mangakakalot.gg/search/story/dragon-ball' \
      -H 'cookie: _ga=GA1.1.1' \
      -H 'user-agent: Mozilla/5.0'`;

    const opts: RunAuthOptions = {
      logger: buildLogger(),
      dataHome: tmpDir,
      readStdin: async () => curlNoClear,
      fetch: buildFetch(200, "ok"),
    };
    await expect(runAuth(opts)).rejects.toMatchObject({
      message: expect.stringContaining("missing cf_clearance"),
    });
  });

  test("throws AuthError when user-agent is absent", async () => {
    const curlNoUA = `curl 'https://www.mangakakalot.gg/search/story/dragon-ball' \
      -H 'cookie: cf_clearance=abc'`;

    const opts: RunAuthOptions = {
      logger: buildLogger(),
      dataHome: tmpDir,
      readStdin: async () => curlNoUA,
      fetch: buildFetch(200, "ok"),
    };
    await expect(runAuth(opts)).rejects.toMatchObject({
      message: expect.stringContaining("missing user-agent"),
    });
  });
});

describe("runAuth — fetch URL", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scanldr-auth-url-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("verifies session against the URL parsed from the cURL", async () => {
    let capturedUrl: string | undefined;

    const capturingFetch: RunAuthOptions["fetch"] = async (url, _init) => {
      capturedUrl = url as string;
      return {
        status: 200,
        ok: true,
        text: async () => "<html>MangaKakalot</html>",
      } as Response;
    };

    const opts: RunAuthOptions = {
      logger: buildLogger(),
      dataHome: tmpDir,
      readStdin: async () => VALID_CURL,
      fetch: capturingFetch,
    };

    await runAuth(opts);

    expect(capturedUrl).toBe("https://www.mangakakalot.gg/search/story/dragon-ball");
  });
});

describe("runAuth — session verification", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scanldr-auth-verify-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("throws AuthError on 403 response", async () => {
    const opts: RunAuthOptions = {
      logger: buildLogger(),
      dataHome: tmpDir,
      readStdin: async () => VALID_CURL,
      fetch: buildFetch(403, ""),
    };
    await expect(runAuth(opts)).rejects.toMatchObject({
      message: expect.stringContaining("session verification failed"),
    });
  });

  test("throws AuthError when response body contains 'Just a moment...'", async () => {
    const opts: RunAuthOptions = {
      logger: buildLogger(),
      dataHome: tmpDir,
      readStdin: async () => VALID_CURL,
      fetch: buildFetch(200, "<title>Just a moment...</title>"),
    };
    await expect(runAuth(opts)).rejects.toMatchObject({
      message: expect.stringContaining("session verification failed"),
    });
  });

  test("throws AuthError when response body contains 'Enable JavaScript and cookies'", async () => {
    const opts: RunAuthOptions = {
      logger: buildLogger(),
      dataHome: tmpDir,
      readStdin: async () => VALID_CURL,
      fetch: buildFetch(200, "Enable JavaScript and cookies to continue"),
    };
    await expect(runAuth(opts)).rejects.toMatchObject({
      message: expect.stringContaining("session verification failed"),
    });
  });

  test("throws AuthError on 503 response", async () => {
    const opts: RunAuthOptions = {
      logger: buildLogger(),
      dataHome: tmpDir,
      readStdin: async () => VALID_CURL,
      fetch: buildFetch(503, "Service Unavailable"),
    };
    await expect(runAuth(opts)).rejects.toMatchObject({
      message: expect.stringContaining("session verification failed: HTTP 503"),
    });
  });

  test("throws AuthError wrapping network error when fetch rejects", async () => {
    const opts: RunAuthOptions = {
      logger: buildLogger(),
      dataHome: tmpDir,
      readStdin: async () => VALID_CURL,
      fetch: async () => {
        throw new Error("ECONNRESET");
      },
    };
    await expect(runAuth(opts)).rejects.toMatchObject({
      message: expect.stringContaining("network error"),
    });
  });
});

describe("runAuth — persist", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scanldr-auth-persist-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("saves auth.json with correct shape on success", async () => {
    const opts: RunAuthOptions = {
      logger: buildLogger(),
      dataHome: tmpDir,
      readStdin: async () => VALID_CURL,
      fetch: buildFetch(200, "<html>MangaKakalot</html>"),
    };

    await runAuth(opts);

    const outPath = resolveAuthPath({ dataHome: tmpDir });
    const raw = await readFile(outPath, "utf8");
    const parsed = JSON.parse(raw) as {
      cookies: Record<string, string>;
      userAgent: string;
      savedAt: number;
    };

    expect(parsed.cookies.cf_clearance).toBe("test_clearance");
    expect(parsed.cookies._ga).toBe("GA1.1.123");
    expect(parsed.userAgent).toBe("Mozilla/5.0 (test)");
    expect(typeof parsed.savedAt).toBe("number");
  });

  test("saves auth.json with mode 0600", async () => {
    const opts: RunAuthOptions = {
      logger: buildLogger(),
      dataHome: tmpDir,
      readStdin: async () => VALID_CURL,
      fetch: buildFetch(200, "<html>MangaKakalot</html>"),
    };

    await runAuth(opts);

    const outPath = resolveAuthPath({ dataHome: tmpDir });
    const st = await stat(outPath);
    const perms = st.mode & 0o777;
    expect(perms).toBe(0o600);
  });

  test("auth.json is consumable by FallbackHttpClient (savedAt is a number)", async () => {
    const opts: RunAuthOptions = {
      logger: buildLogger(),
      dataHome: tmpDir,
      readStdin: async () => VALID_CURL,
      fetch: buildFetch(200, "<html>MangaKakalot</html>"),
    };

    await runAuth(opts);

    const outPath = resolveAuthPath({ dataHome: tmpDir });
    const raw = await readFile(outPath, "utf8");
    const parsed = JSON.parse(raw) as { cookies: unknown; userAgent: unknown; savedAt: unknown };

    // These are the exact fields checked by isValidAuthSession in fallback-http/service.ts
    expect(parsed.cookies !== null && typeof parsed.cookies === "object").toBe(true);
    expect(typeof parsed.userAgent).toBe("string");
    expect(typeof parsed.savedAt).toBe("number");
  });
});

describe("runAuth — atomic write", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scanldr-auth-atomic-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("writes atomically via rename of .tmp file (no .tmp remains after success)", async () => {
    const opts: RunAuthOptions = {
      logger: buildLogger(),
      dataHome: tmpDir,
      readStdin: async () => VALID_CURL,
      fetch: buildFetch(200, "<html>MangaKakalot</html>"),
    };

    await runAuth(opts);

    const outPath = resolveAuthPath({ dataHome: tmpDir });
    const tmpPath = `${outPath}.tmp`;

    // Final file must exist
    const finalStat = await stat(outPath);
    expect(finalStat.isFile()).toBe(true);

    // Temp file must have been removed (renamed away)
    await expect(stat(tmpPath)).rejects.toThrow();
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

  test("name is AuthError", () => {
    expect(new AuthError("x").name).toBe("AuthError");
  });
});
