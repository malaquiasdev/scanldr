import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@plugins/logger/index.ts";
import {
  CloudflareError,
  CrossOriginCloudflareError,
  createFallbackHttp,
  MissingAuthError,
} from "./index.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeLogger(): {
  logger: Logger;
  calls: Array<{ level: string; fields: Record<string, unknown>; msg: string }>;
} {
  const calls: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
  const logger: Logger = {
    info: (fields, msg) => calls.push({ level: "info", fields, msg }),
    warn: (fields, msg) => calls.push({ level: "warn", fields, msg }),
    error: (fields, msg) => calls.push({ level: "error", fields, msg }),
  };
  return { logger, calls };
}

function makeFakeResponse(status: number): Response {
  return new Response(null, { status });
}

const VALID_SESSION = {
  cookies: { cf_clearance: "abc123", __cf_bm: "xyz" },
  userAgent: "Mozilla/5.0 TestUA",
  savedAt: 1700000000000,
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await makeTempDir(join(tmpdir(), "fallback-http-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function makeTempDir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return path;
}

async function writeAuth(dir: string, content: unknown): Promise<string> {
  const path = join(dir, "auth.json");
  await writeFile(path, typeof content === "string" ? content : JSON.stringify(content), "utf8");
  return path;
}

// ---------------------------------------------------------------------------
// Test 1: Missing file → MissingAuthError
// ---------------------------------------------------------------------------

test("missing auth file throws MissingAuthError", async () => {
  const { logger, calls } = makeLogger();
  const path = join(tmpDir, "nonexistent.json");

  await expect(createFallbackHttp({ authPath: path, logger })).rejects.toBeInstanceOf(
    MissingAuthError,
  );

  const warnCall = calls.find((c) => c.level === "warn");
  expect(warnCall).toBeDefined();
  expect(warnCall?.fields.reason).toBe("missing");
  expect(warnCall?.fields.path).toBe(path);
});

// ---------------------------------------------------------------------------
// Test 2: Corrupt file (not JSON) → MissingAuthError
// ---------------------------------------------------------------------------

test("corrupt auth file (not JSON) throws MissingAuthError", async () => {
  const { logger, calls } = makeLogger();
  const path = await writeAuth(tmpDir, "not json");

  await expect(createFallbackHttp({ authPath: path, logger })).rejects.toBeInstanceOf(
    MissingAuthError,
  );

  const warnCall = calls.find((c) => c.level === "warn");
  expect(warnCall).toBeDefined();
  expect(warnCall?.fields.reason).toBe("corrupt");
});

// ---------------------------------------------------------------------------
// Test 3: Wrong shape → MissingAuthError (corrupt path)
// ---------------------------------------------------------------------------

describe("wrong shape → MissingAuthError", () => {
  test("empty object", async () => {
    const { logger } = makeLogger();
    const path = await writeAuth(tmpDir, {});

    await expect(createFallbackHttp({ authPath: path, logger })).rejects.toBeInstanceOf(
      MissingAuthError,
    );
  });

  test("cookies is a string instead of object", async () => {
    const { logger } = makeLogger();
    const path = await writeAuth(tmpDir, {
      cookies: "string-instead-of-object",
      userAgent: "UA",
      savedAt: 123,
    });

    await expect(createFallbackHttp({ authPath: path, logger })).rejects.toBeInstanceOf(
      MissingAuthError,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 4: Happy construction + get → 200 with correct headers
// ---------------------------------------------------------------------------

test("happy construction + get sends Cookie and User-Agent headers", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  const capturedHeaders: Record<string, string> = {};
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> = async (
    _url,
    init,
  ) => {
    const headers = init?.headers as Record<string, string>;
    Object.assign(capturedHeaders, headers);
    return makeFakeResponse(200);
  };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => Date.now(),
  });

  const res = await client.get("https://example.com/page");
  expect(res.status).toBe(200);

  // Cookie header must contain all cookies (order independent).
  const cookieParts = new Set((capturedHeaders.cookie ?? "").split("; "));
  expect(cookieParts).toContain("cf_clearance=abc123");
  expect(cookieParts).toContain("__cf_bm=xyz");

  expect(capturedHeaders["user-agent"]).toBe(VALID_SESSION.userAgent);
});

// ---------------------------------------------------------------------------
// Test 5: Cookie values and UA are never logged
// ---------------------------------------------------------------------------

test("cookie values and UA string are never logged", async () => {
  const SENTINEL_UA = "SENTINEL_USERAGENT_UNIQUE_12345";
  const SENTINEL_COOKIE_VAL = "SENTINEL_COOKIE_VALUE_67890";

  const session = {
    cookies: { cf_clearance: SENTINEL_COOKIE_VAL },
    userAgent: SENTINEL_UA,
    savedAt: 1700000000000,
  };

  const { logger, calls } = makeLogger();
  const path = await writeAuth(tmpDir, session);

  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => makeFakeResponse(200);

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await client.get("https://example.com/test");

  const allPayloads = JSON.stringify(calls);
  expect(allPayloads).not.toContain(SENTINEL_UA);
  expect(allPayloads).not.toContain(SENTINEL_COOKIE_VAL);
});

// ---------------------------------------------------------------------------
// Test 6: 403 → CloudflareError, no retry
// ---------------------------------------------------------------------------

test("403 throws CloudflareError without retrying", async () => {
  const { logger, calls } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return makeFakeResponse(403);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await expect(client.get("https://example.com/")).rejects.toBeInstanceOf(CloudflareError);

  // Exactly one fetch attempt — no retry on 403.
  expect(fetchCount).toBe(1);

  const warnCall = calls.find(
    (c) => c.level === "warn" && c.fields.event === "fallback_http.cloudflare_rejected",
  );
  expect(warnCall).toBeDefined();
});

// ---------------------------------------------------------------------------
// Test 7: 5xx then 200 → resolves, one retry warn
// ---------------------------------------------------------------------------

test("5xx then 200 resolves with the 200 response after one retry", async () => {
  const { logger, calls } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let call = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      call++;
      return call === 1 ? makeFakeResponse(503) : makeFakeResponse(200);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  const res = await client.get("https://example.com/");
  expect(res.status).toBe(200);

  const retryWarns = calls.filter(
    (c) => c.level === "warn" && c.fields.event === "fallback_http.retry",
  );
  expect(retryWarns).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Test 8: Network error then success → resolves, one retry warn
// ---------------------------------------------------------------------------

test("network error then success resolves after one retry", async () => {
  const { logger, calls } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let call = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      call++;
      if (call === 1) throw new Error("ECONNRESET");
      return makeFakeResponse(200);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  const res = await client.get("https://example.com/");
  expect(res.status).toBe(200);

  const retryWarns = calls.filter(
    (c) => c.level === "warn" && c.fields.event === "fallback_http.retry",
  );
  expect(retryWarns).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Test 9: Permanent 5xx exhaustion → throws, 3 retry warns
// ---------------------------------------------------------------------------

test("permanent 5xx exhausts all attempts and throws with 3 retry warns", async () => {
  const { logger, calls } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return makeFakeResponse(500);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await expect(client.get("https://example.com/")).rejects.toThrow(/500/);

  // 4 total attempts (1 initial + 3 retries).
  expect(fetchCount).toBe(4);

  const retryWarns = calls.filter(
    (c) => c.level === "warn" && c.fields.event === "fallback_http.retry",
  );
  // 3 retry warns (before attempts 2, 3, 4).
  expect(retryWarns).toHaveLength(3);

  // P2 #4: Assert structured payload on each retry warn.
  const expectedUrl = "https://example.com/";
  expect(retryWarns[0]).toMatchObject({
    fields: {
      event: "fallback_http.retry",
      context: "fallback-http",
      attempt: 1,
      status: 500,
      url: expectedUrl,
      waitMs: expect.any(Number),
    },
  });
  expect(retryWarns[1]).toMatchObject({
    fields: {
      event: "fallback_http.retry",
      context: "fallback-http",
      attempt: 2,
      status: 500,
      url: expectedUrl,
      waitMs: expect.any(Number),
    },
  });
  expect(retryWarns[2]).toMatchObject({
    fields: {
      event: "fallback_http.retry",
      context: "fallback-http",
      attempt: 3,
      status: 500,
      url: expectedUrl,
      waitMs: expect.any(Number),
    },
  });
});

// ---------------------------------------------------------------------------
// Test 10: 404 returned, not retried
// ---------------------------------------------------------------------------

test("404 is returned to caller without retrying", async () => {
  const { logger, calls } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return makeFakeResponse(404);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  const res = await client.get("https://example.com/missing");
  expect(res.status).toBe(404);
  expect(fetchCount).toBe(1);

  const retryWarns = calls.filter((c) => c.fields.event === "fallback_http.retry");
  expect(retryWarns).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Test 11: Rate limit ceiling — second call sleeps the remainder
// ---------------------------------------------------------------------------

test("second get call sleeps the remainder of the 1s window", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  // Deterministic clock: first call at t=0, second call at t=300ms.
  let mockTime = 0;
  const sleepArgs: number[] = [];

  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      // Simulate 100ms passing per fetch.
      mockTime += 100;
      return makeFakeResponse(200);
    };

  const fakeSleep = async (ms: number) => {
    sleepArgs.push(ms);
    // Advance clock by the sleep amount.
    mockTime += ms;
  };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: fakeSleep,
    now: () => mockTime,
  });

  // First request — no throttle needed.
  await client.get("https://example.com/1");

  // Advance clock by 300ms (simulate caller overhead).
  mockTime += 300;

  // Second request should sleep ~600ms (1000 - 400ms elapsed [100ms fetch + 300ms caller]).
  await client.get("https://example.com/2");

  // At least one sleep was issued for the throttle.
  expect(sleepArgs.length).toBeGreaterThanOrEqual(1);
  // The throttle sleep should be > 0.
  const throttleSleep = sleepArgs[0];
  expect(throttleSleep).toBeGreaterThan(0);
  expect(throttleSleep).toBeLessThanOrEqual(1000);
});

// ---------------------------------------------------------------------------
// Test 12: Concurrent gets serialize through the throttle
// ---------------------------------------------------------------------------

test("concurrent gets serialize so 1 req/s ceiling holds globally", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let mockTime = 0;
  const fetchTimestamps: number[] = [];

  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchTimestamps.push(mockTime);
      return makeFakeResponse(200);
    };

  const fakeSleep = async (ms: number) => {
    mockTime += ms;
  };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: fakeSleep,
    now: () => mockTime,
  });

  // Fire two requests concurrently.
  await Promise.all([client.get("https://example.com/a"), client.get("https://example.com/b")]);

  expect(fetchTimestamps).toHaveLength(2);

  // The second fetch must have started at least 1000ms after the first.
  const gap = (fetchTimestamps[1] ?? 0) - (fetchTimestamps[0] ?? 0);
  expect(gap).toBeGreaterThanOrEqual(1000);
});

// ---------------------------------------------------------------------------
// Test 13 (P2 #3): Three concurrent gets serialize with ≥1000ms gaps
// ---------------------------------------------------------------------------

test("three concurrent gets serialize through the throttle (≥1000ms gaps)", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let mockTime = 0;
  const fetchTimestamps: number[] = [];

  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchTimestamps.push(mockTime);
      return makeFakeResponse(200);
    };

  const fakeSleep = async (ms: number) => {
    mockTime += ms;
  };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: fakeSleep,
    now: () => mockTime,
  });

  // Fire three requests concurrently.
  await Promise.all([
    client.get("https://example.com/a"),
    client.get("https://example.com/b"),
    client.get("https://example.com/c"),
  ]);

  expect(fetchTimestamps).toHaveLength(3);

  const t1 = fetchTimestamps[0] ?? 0;
  const t2 = fetchTimestamps[1] ?? 0;
  const t3 = fetchTimestamps[2] ?? 0;

  expect(t1).toBeLessThan(t2);
  expect(t2).toBeLessThan(t3);
  expect(t2 - t1).toBeGreaterThanOrEqual(1000);
  expect(t3 - t2).toBeGreaterThanOrEqual(1000);
});

// ---------------------------------------------------------------------------
// Test 14 (P2 #2): 400 — returned to caller, no retry
// ---------------------------------------------------------------------------

test("400 — returned to caller, no retry", async () => {
  const { logger, calls } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return makeFakeResponse(400);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  const res = await client.get("https://example.com/bad-request");
  expect(res.status).toBe(400);
  expect(fetchCount).toBe(1);
  expect(calls.filter((c) => c.fields.event === "fallback_http.retry")).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Test 15 (P2 #2): 401 — returned to caller, no retry
// ---------------------------------------------------------------------------

test("401 — returned to caller, no retry", async () => {
  const { logger, calls } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return makeFakeResponse(401);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  const res = await client.get("https://example.com/unauthorized");
  expect(res.status).toBe(401);
  expect(fetchCount).toBe(1);
  expect(calls.filter((c) => c.fields.event === "fallback_http.retry")).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Test 16 (P2 #2): 429 — returned to caller, no retry, no rate-limit handling
// ---------------------------------------------------------------------------

test("429 — returned to caller, no retry, no special handling", async () => {
  const { logger, calls } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      // Include Retry-After header to prove we don't parse it.
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "60", "x-ratelimit-retry-after": "60" },
      });
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  const res = await client.get("https://example.com/rate-limited");
  expect(res.status).toBe(429);
  // Exactly one fetch — no retry logic fires.
  expect(fetchCount).toBe(1);
  // No retry warns and no rate-limit event.
  expect(calls.filter((c) => c.fields.event === "fallback_http.retry")).toHaveLength(0);
  // The sleep injector was never called with a rate-limit derived value.
  // (sleep is async ()=>{} above — if it were called we'd still pass, but
  //  fetchCount===1 already proves no retry path was taken.)
});

// ---------------------------------------------------------------------------
// Test 17 (P2 #1): Empty cookies {} — valid session, Cookie header omitted
// ---------------------------------------------------------------------------

test("empty cookies {} — get omits Cookie header, sends User-Agent, no throw", async () => {
  const { logger, calls } = makeLogger();
  const emptyCookiesSession = {
    cookies: {},
    userAgent: "Mozilla/5.0 TestUA",
    savedAt: 1700000000000,
  };
  const path = await writeAuth(tmpDir, emptyCookiesSession);

  const capturedHeaders: Record<string, string> = {};
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> = async (
    _url,
    init,
  ) => {
    Object.assign(capturedHeaders, init?.headers as Record<string, string>);
    return makeFakeResponse(200);
  };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  const res = await client.get("https://example.com/page");
  expect(res.status).toBe(200);

  // User-Agent is present.
  expect(capturedHeaders["user-agent"]).toBe(emptyCookiesSession.userAgent);
  // Cookie header must NOT be present (not even as empty string).
  expect("cookie" in capturedHeaders).toBe(false);

  // No warn or error emitted.
  expect(calls.filter((c) => c.level === "warn" || c.level === "error")).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Test 18: Optional extra headers are merged; cookie/user-agent cannot be overridden
// ---------------------------------------------------------------------------

test("optional extra headers are merged; cookie and user-agent cannot be overridden by caller", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  const capturedHeaders: Record<string, string> = {};
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> = async (
    _url,
    init,
  ) => {
    Object.assign(capturedHeaders, init?.headers as Record<string, string>);
    return makeFakeResponse(200);
  };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await client.get("https://example.com/page", {
    referer: "https://www.mangakakalot.gg/",
    accept: "application/json",
    // Attempt to override auth headers — should be silently ignored.
    cookie: "attacker=evil",
    "user-agent": "AttackerUA",
  });

  // Extra headers were merged.
  expect(capturedHeaders.referer).toBe("https://www.mangakakalot.gg/");
  expect(capturedHeaders.accept).toBe("application/json");

  // Auth headers were NOT overridden.
  const cookieParts = new Set((capturedHeaders.cookie ?? "").split("; "));
  expect(cookieParts).toContain("cf_clearance=abc123");
  expect(cookieParts).not.toContain("attacker=evil");
  expect(capturedHeaders["user-agent"]).toBe(VALID_SESSION.userAgent);
  expect(capturedHeaders["user-agent"]).not.toBe("AttackerUA");
});

// Test 18b: Capitalized header key (Cookie:) is also rejected — k.toLowerCase() guard
// ---------------------------------------------------------------------------

test("capitalized Cookie header from caller does not override auto-built cookie", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  const capturedHeaders: Record<string, string> = {};
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> = async (
    _url,
    init,
  ) => {
    Object.assign(capturedHeaders, init?.headers as Record<string, string>);
    return makeFakeResponse(200);
  };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await client.get("https://example.com/page", {
    // Capitalized key — the toLowerCase() guard in service.ts must block this too.
    Cookie: "attacker=evil",
  });

  // Auto-built cookie must still be present.
  const cookieParts = new Set((capturedHeaders.cookie ?? "").split("; "));
  expect(cookieParts).toContain("cf_clearance=abc123");
  // The attacker's value must not appear in the outgoing cookie header.
  expect(cookieParts).not.toContain("attacker=evil");
});

// ---------------------------------------------------------------------------
// Test 19 (P2-2): Credential reload — after auth.json is rewritten, the next
// request uses the NEW cookies, not the stale ones captured at construction.
// This is the integration test that would have caught P0-1.
// ---------------------------------------------------------------------------

test("credential reload: after auth.json rewrite, next request sends new cookies", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  const capturedCookieHeaders: string[] = [];
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> = async (
    _url,
    init,
  ) => {
    const headers = init?.headers as Record<string, string>;
    capturedCookieHeaders.push(headers.cookie ?? "");
    return makeFakeResponse(200);
  };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  // First request — should use VALID_SESSION cookies.
  await client.get("https://example.com/first");
  expect(capturedCookieHeaders[0]).toContain("cf_clearance=abc123");

  // Simulate refreshSession: overwrite auth.json with new credentials.
  const REFRESHED_SESSION = {
    cookies: { cf_clearance: "NEW_TOKEN", __cf_bm: "NEW_BM" },
    userAgent: "Mozilla/5.0 RefreshedUA",
    savedAt: Date.now(),
  };
  // Small delay to guarantee mtime changes (filesystem resolution is ~1ms).
  await new Promise((r) => setTimeout(r, 10));
  await writeFile(path, JSON.stringify(REFRESHED_SESSION), "utf8");

  // Second request — must pick up the NEW credentials from the rewritten file.
  await client.get("https://example.com/second");

  expect(capturedCookieHeaders).toHaveLength(2);
  const secondCookies = capturedCookieHeaders[1] ?? "";
  // Must contain new token.
  expect(secondCookies).toContain("cf_clearance=NEW_TOKEN");
  expect(secondCookies).toContain("__cf_bm=NEW_BM");
  // Must NOT contain old stale token.
  expect(secondCookies).not.toContain("cf_clearance=abc123");
});

// ---------------------------------------------------------------------------
// Test 20 (P1-1): 200 with CF challenge HTML → throws CloudflareError
// ---------------------------------------------------------------------------

test("200 with CF challenge HTML body throws CloudflareError", async () => {
  const { logger, calls } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const CF_CHALLENGE_BODY =
    "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>" +
    "<div id='cf-browser-verification'>cloudflare cf_clearance challenge</div>" +
    "</body></html>";

  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return new Response(CF_CHALLENGE_BODY, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await expect(client.get("https://example.com/")).rejects.toBeInstanceOf(CloudflareError);

  // No retry on CF challenge.
  expect(fetchCount).toBe(1);

  const warnCall = calls.find(
    (c) => c.level === "warn" && c.fields.event === "fallback_http.cloudflare_rejected",
  );
  expect(warnCall).toBeDefined();
});

// ---------------------------------------------------------------------------
// Test 21: Normal 200 with real HTML is NOT falsely flagged as CF challenge
// ---------------------------------------------------------------------------

test("200 with real manga HTML is returned to caller without throwing", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  const REAL_HTML = "<html><body><div class='manga-list'><h2>Naruto Vol.1</h2></div></body></html>";

  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => new Response(REAL_HTML, { status: 200, headers: { "content-type": "text/html" } });

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  const res = await client.get("https://example.com/manga/naruto");
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain("Naruto Vol.1");
});

// ---------------------------------------------------------------------------
// Test 21b: Binary response (image/webp) is returned byte-perfect — no UTF-8 mangling
// ---------------------------------------------------------------------------

test("200 with image/webp content-type returns binary body unchanged", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  // WebP magic bytes + bytes that are invalid UTF-8 (would become EF BF BD if decoded as text)
  const original = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x80, 0xff, 0xc0, 0xef,
    0xbf, 0xbe, 0xaa, 0xbb, 0xcc, 0xdd,
  ]);

  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () =>
      new Response(original, {
        status: 200,
        headers: { "content-type": "image/webp" },
      });

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  const res = await client.getAnonymous("https://cdn.example.com/page.webp");
  const buf = new Uint8Array(await res.arrayBuffer());
  expect(buf.length).toBe(original.length);
  expect(Array.from(buf)).toEqual(Array.from(original));
});

// ---------------------------------------------------------------------------
// Test 22: Short-circuit after 403 — second call skips HTTP (fetch called once)
// ---------------------------------------------------------------------------

test("short-circuit after 403: second request skips fetch and throws CloudflareError", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return makeFakeResponse(403);
    };

  const sleepArgs: number[] = [];
  const fakeSleep = async (ms: number) => {
    sleepArgs.push(ms);
  };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: fakeSleep,
    // Use a fixed clock so no throttle sleep fires between requests.
    now: () => 0,
  });

  // First call — real 403, latch should be set.
  await expect(client.get("https://example.com/page1")).rejects.toBeInstanceOf(CloudflareError);

  // Second call — mtime unchanged, must short-circuit WITHOUT calling fetch.
  await expect(client.get("https://example.com/page2")).rejects.toBeInstanceOf(CloudflareError);

  // Fetch was only called once (first request). Short-circuit skipped the second.
  expect(fetchCount).toBe(1);

  // No throttle sleep should have fired between the two calls (short-circuit exits before sleep).
  // sleepArgs may be empty or contain only intra-retry sleeps; none should be ≥1000.
  const throttleSleeps = sleepArgs.filter((ms) => ms >= 1000);
  expect(throttleSleeps).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Test 23: Latch clears when mtime advances (auth.json rewritten)
// ---------------------------------------------------------------------------

test("latch clears after mtime advances: subsequent request proceeds normally", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  let respondWith200 = false;

  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return respondWith200 ? makeFakeResponse(200) : makeFakeResponse(403);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  // First call — 403, latch set.
  await expect(client.get("https://example.com/a")).rejects.toBeInstanceOf(CloudflareError);
  expect(fetchCount).toBe(1);

  // Simulate refreshSession: rewrite auth.json (advancing mtime).
  await new Promise((r) => setTimeout(r, 10));
  await writeFile(path, JSON.stringify({ ...VALID_SESSION, savedAt: Date.now() }), "utf8");
  respondWith200 = true;

  // Third call — mtime advanced, latch cleared, fetch is invoked again.
  const res = await client.get("https://example.com/c");
  expect(res.status).toBe(200);
  expect(fetchCount).toBe(2);
});

// ---------------------------------------------------------------------------
// Test 24: 200 CF-body also latches — second request short-circuits
// ---------------------------------------------------------------------------

test("short-circuit after 200 CF-body: second request skips fetch", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  const CF_BODY =
    "<!DOCTYPE html><html><body>" +
    "<div id='cf-browser-verification'>cloudflare cf_clearance challenge</div>" +
    "</body></html>";

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return new Response(CF_BODY, { status: 200, headers: { "content-type": "text/html" } });
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await expect(client.get("https://example.com/page1")).rejects.toBeInstanceOf(CloudflareError);
  await expect(client.get("https://example.com/page2")).rejects.toBeInstanceOf(CloudflareError);

  // Fetch called only once — second request was short-circuited.
  expect(fetchCount).toBe(1);
});

// ---------------------------------------------------------------------------
// Test 25: No latch on normal 2xx — subsequent requests proceed normally
// ---------------------------------------------------------------------------

test("no latch on normal 200: subsequent requests hit fetch normally", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return makeFakeResponse(200);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await client.get("https://example.com/1");
  await client.get("https://example.com/2");
  await client.get("https://example.com/3");

  // All three requests hit fetch — no latch set.
  expect(fetchCount).toBe(3);
});

// ---------------------------------------------------------------------------
// Tests for getAnonymous
// ---------------------------------------------------------------------------

test("getAnonymous omits Cookie header but still sends User-Agent", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  const capturedHeaders: Record<string, string> = {};
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> = async (
    _url,
    init,
  ) => {
    Object.assign(capturedHeaders, init?.headers as Record<string, string>);
    return makeFakeResponse(200);
  };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  const res = await client.getAnonymous("https://img-r1.2xstorage.com/example/1/0.webp");
  expect(res.status).toBe(200);

  // Cookie must NOT be present — CDN is a different Cloudflare zone.
  expect("cookie" in capturedHeaders).toBe(false);

  // User-Agent from auth session must still be sent.
  expect(capturedHeaders["user-agent"]).toBe(VALID_SESSION.userAgent);
});

test("getAnonymous forwards caller extraHeaders (e.g. referer)", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  const capturedHeaders: Record<string, string> = {};
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> = async (
    _url,
    init,
  ) => {
    Object.assign(capturedHeaders, init?.headers as Record<string, string>);
    return makeFakeResponse(200);
  };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await client.getAnonymous("https://img-r1.2xstorage.com/example/1/0.webp", {
    referer: "https://www.mangakakalot.gg/",
    accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "sec-fetch-dest": "image",
    "sec-fetch-mode": "no-cors",
    "sec-fetch-site": "cross-site",
  });

  expect(capturedHeaders.referer).toBe("https://www.mangakakalot.gg/");
  expect(capturedHeaders.accept).toBe(
    "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  );
  expect(capturedHeaders["sec-fetch-dest"]).toBe("image");
  expect(capturedHeaders["sec-fetch-mode"]).toBe("no-cors");
  expect(capturedHeaders["sec-fetch-site"]).toBe("cross-site");

  // Cookie still absent even when caller passes extra headers.
  expect("cookie" in capturedHeaders).toBe(false);
});

test("getAnonymous serializes through the same chain as get", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let mockTime = 0;
  const fetchTimestamps: number[] = [];

  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchTimestamps.push(mockTime);
      return makeFakeResponse(200);
    };

  const fakeSleep = async (ms: number) => {
    mockTime += ms;
  };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: fakeSleep,
    now: () => mockTime,
  });

  // Mix one get + one getAnonymous concurrently — both must share the same chain.
  await Promise.all([
    client.get("https://www.mangakakalot.gg/chapter/1"),
    client.getAnonymous("https://img-r1.2xstorage.com/example/1/0.webp"),
  ]);

  expect(fetchTimestamps).toHaveLength(2);

  // Second fetch must have started at least 1000ms after the first (throttle fired).
  const gap = (fetchTimestamps[1] ?? 0) - (fetchTimestamps[0] ?? 0);
  expect(gap).toBeGreaterThanOrEqual(1000);
});

test("short-circuit bypasses throttle sleep", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return makeFakeResponse(403);
    };

  const sleepCalls: number[] = [];
  const fakeSleep = async (ms: number) => {
    sleepCalls.push(ms);
  };

  // Use a real-ish clock so throttle WOULD fire between requests if not short-circuited.
  let t = 0;
  const fakeNow = () => t;

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: fakeSleep,
    now: fakeNow,
  });

  // First request at t=0 — real fetch, 403, latch set.
  await expect(client.get("https://example.com/a")).rejects.toBeInstanceOf(CloudflareError);
  // Only 1ms passes — throttle WOULD sleep ~999ms on a normal second request.
  t = 1;

  // Second request — short-circuit, must NOT call sleep (no throttle).
  await expect(client.get("https://example.com/b")).rejects.toBeInstanceOf(CloudflareError);

  expect(fetchCount).toBe(1);
  // The only sleep calls permitted are backoff sleeps within retry loops,
  // which only happen on 5xx. Since we got 403, no sleeps should have occurred.
  expect(sleepCalls).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Issue #137: latch is split per lane (site vs. anonymous/CDN)
// ---------------------------------------------------------------------------

test("403 on getAnonymous throws CrossOriginCloudflareError and does NOT latch the site lane", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return makeFakeResponse(403);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  // Anonymous lane 403 — throws the cross-origin variant.
  await expect(client.getAnonymous("https://cdn.example.com/page.webp")).rejects.toBeInstanceOf(
    CrossOriginCloudflareError,
  );
  expect(fetchCount).toBe(1);

  // get() on the site lane must still hit fetch — the anonymous lane's latch
  // must not bleed into the site lane (AC #1). The fake fetch also returns 403
  // here, so get() throws CloudflareError (site-lane class) from its OWN real
  // fetch call, proving no short-circuit occurred.
  await expect(client.get("https://example.com/different-url")).rejects.toBeInstanceOf(
    CloudflareError,
  );
  expect(fetchCount).toBe(2);
});

test("403 on get() continues to short-circuit subsequent get() calls (regression guard)", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return makeFakeResponse(403);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await expect(client.get("https://example.com/a")).rejects.toBeInstanceOf(CloudflareError);
  expect(fetchCount).toBe(1);

  // Site lane latch still active — second get() short-circuits without a fetch call.
  await expect(client.get("https://example.com/b")).rejects.toBeInstanceOf(CloudflareError);
  expect(fetchCount).toBe(1);
});

test("403 on get() does NOT latch the anonymous lane — getAnonymous still hits fetch", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return makeFakeResponse(403);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await expect(client.get("https://example.com/site")).rejects.toBeInstanceOf(CloudflareError);
  expect(fetchCount).toBe(1);

  // Documented semantics: site-lane rejection does not short-circuit the anonymous
  // lane. getAnonymous still performs its own fetch (and gets its own 403 here).
  await expect(client.getAnonymous("https://cdn.example.com/img.webp")).rejects.toBeInstanceOf(
    CrossOriginCloudflareError,
  );
  expect(fetchCount).toBe(2);
});

test("same-lane short-circuit still works independently for getAnonymous", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return makeFakeResponse(403);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await expect(client.getAnonymous("https://cdn.example.com/a.webp")).rejects.toBeInstanceOf(
    CrossOriginCloudflareError,
  );
  expect(fetchCount).toBe(1);

  // Second anonymous-lane call short-circuits (dedupe within the same lane, AC #3).
  await expect(client.getAnonymous("https://cdn.example.com/b.webp")).rejects.toBeInstanceOf(
    CrossOriginCloudflareError,
  );
  expect(fetchCount).toBe(1);
});

test("anonymous lane latch clears independently when auth.json mtime advances", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  let respondWith200 = false;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return respondWith200 ? makeFakeResponse(200) : makeFakeResponse(403);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await expect(client.getAnonymous("https://cdn.example.com/a.webp")).rejects.toBeInstanceOf(
    CrossOriginCloudflareError,
  );
  expect(fetchCount).toBe(1);

  await new Promise((r) => setTimeout(r, 10));
  await writeFile(path, JSON.stringify({ ...VALID_SESSION, savedAt: Date.now() }), "utf8");
  respondWith200 = true;

  const res = await client.getAnonymous("https://cdn.example.com/b.webp");
  expect(res.status).toBe(200);
  expect(fetchCount).toBe(2);
});

// ---------------------------------------------------------------------------
// P1 #1: 200-with-CF-challenge-body on the ANONYMOUS lane
// ---------------------------------------------------------------------------

test("200 with CF challenge body on getAnonymous throws CrossOriginCloudflareError, latches only the anonymous lane", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  const CF_CHALLENGE_BODY =
    "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>" +
    "<div id='cf-browser-verification'>cloudflare cf_clearance challenge</div>" +
    "</body></html>";

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return new Response(CF_CHALLENGE_BODY, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await expect(
    client.getAnonymous("https://cdn.example.com/challenge.webp"),
  ).rejects.toBeInstanceOf(CrossOriginCloudflareError);
  expect(fetchCount).toBe(1);

  // The site lane must NOT be latched — a subsequent get() to a different URL still hits fetch.
  // Fake fetch returns the same CF body, so get() throws the site-lane CloudflareError from
  // its own real fetch call, proving no short-circuit occurred.
  await expect(client.get("https://example.com/site-page")).rejects.toBeInstanceOf(CloudflareError);
  expect(fetchCount).toBe(2);
});

// ---------------------------------------------------------------------------
// P1 #2: Both lanes rejected within the same bundle / mtime — independent latches
// ---------------------------------------------------------------------------

test("both lanes rejected within the same mtime: latches coexist independently", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return makeFakeResponse(403);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  // Site lane rejected first — sets the site latch.
  await expect(client.get("https://example.com/a")).rejects.toBeInstanceOf(CloudflareError);
  expect(fetchCount).toBe(1);

  // Anonymous lane rejected next, same mtime — sets the anonymous latch independently.
  await expect(client.getAnonymous("https://cdn.example.com/a.webp")).rejects.toBeInstanceOf(
    CrossOriginCloudflareError,
  );
  expect(fetchCount).toBe(2);

  // Subsequent get() short-circuits with CloudflareError (site latch still active).
  await expect(client.get("https://example.com/b")).rejects.toBeInstanceOf(CloudflareError);
  expect(fetchCount).toBe(2);

  // Subsequent getAnonymous() short-circuits with CrossOriginCloudflareError (anon latch
  // still active) — neither latch clobbered the other.
  await expect(client.getAnonymous("https://cdn.example.com/b.webp")).rejects.toBeInstanceOf(
    CrossOriginCloudflareError,
  );
  expect(fetchCount).toBe(2);
});

// ---------------------------------------------------------------------------
// C3: isTextualContentType gate — binary bodies must never be decoded as text
// ---------------------------------------------------------------------------

test("does not decode a binary 200 body as text", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  // Bytes invalid as UTF-8 — decoding as text would corrupt them (replacement chars).
  const original = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0xaa, 0xbb]);

  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () =>
      new Response(original, {
        status: 200,
        headers: { "content-type": "image/png" },
      });

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  const res = await client.get("https://example.com/img.png");
  const buf = new Uint8Array(await res.arrayBuffer());
  expect(Array.from(buf)).toEqual(Array.from(original));
});

test("treats a 200 Cloudflare-challenge body like a 403", async () => {
  const { logger, calls } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  const CF_BODY =
    "<!DOCTYPE html><html><body>" +
    "<div id='cf-browser-verification'>cloudflare cf_clearance challenge</div>" +
    "</body></html>";

  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => new Response(CF_BODY, { status: 200, headers: { "content-type": "text/html" } });

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await expect(client.get("https://example.com/page")).rejects.toBeInstanceOf(CloudflareError);

  const warnCall = calls.find(
    (c) => c.level === "warn" && c.fields.event === "fallback_http.cloudflare_rejected",
  );
  expect(warnCall).toBeDefined();
});

// ---------------------------------------------------------------------------
// C7: mergeHeadersPreservingAuth — caller headers cannot override auth headers
// ---------------------------------------------------------------------------

test("caller-supplied headers cannot override cookie/user-agent", async () => {
  const { logger } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  const capturedHeaders: Record<string, string> = {};
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> = async (
    _url,
    init,
  ) => {
    Object.assign(capturedHeaders, init?.headers as Record<string, string>);
    return makeFakeResponse(200);
  };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await client.get("https://example.com/page", {
    cookie: "attacker=evil",
    "user-agent": "AttackerUA",
    "x-custom": "kept",
  });

  const cookieParts = new Set((capturedHeaders.cookie ?? "").split("; "));
  expect(cookieParts).toContain("cf_clearance=abc123");
  expect(cookieParts).not.toContain("attacker=evil");
  expect(capturedHeaders["user-agent"]).toBe(VALID_SESSION.userAgent);
  expect(capturedHeaders["x-custom"]).toBe("kept");
});

// ---------------------------------------------------------------------------
// Regression #236: "Just a moment" marker (previously missing from fallback-http's
// own drifted CF-detection copy) is now detected via the shared canonical source.
// ---------------------------------------------------------------------------

test("200 body containing ONLY the 'Just a moment' marker is detected as a CF challenge", async () => {
  const { logger, calls } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  // Deliberately excludes cf-browser-verification/challenge-platform/jschl-answer —
  // isolates the "Just a moment" marker that the old fallback-http copy was missing.
  const JUST_A_MOMENT_BODY =
    "<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>";

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return new Response(JUST_A_MOMENT_BODY, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await expect(client.get("https://example.com/page")).rejects.toBeInstanceOf(CloudflareError);
  expect(fetchCount).toBe(1);

  const warnCall = calls.find(
    (c) => c.level === "warn" && c.fields.event === "fallback_http.cloudflare_rejected",
  );
  expect(warnCall).toBeDefined();
});

// ---------------------------------------------------------------------------
// P2 #4: Explicit dedupe log assertion on anonymous lane short-circuit
// ---------------------------------------------------------------------------

test("anonymous lane short-circuit emits the cloudflare_rejected event only once across two calls", async () => {
  const { logger, calls } = makeLogger();
  const path = await writeAuth(tmpDir, VALID_SESSION);

  let fetchCount = 0;
  const fakeFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
    async () => {
      fetchCount++;
      return makeFakeResponse(403);
    };

  const client = await createFallbackHttp({
    authPath: path,
    logger,
    fetch: fakeFetch,
    sleep: async () => {},
    now: () => 0,
  });

  await expect(client.getAnonymous("https://cdn.example.com/a.webp")).rejects.toBeInstanceOf(
    CrossOriginCloudflareError,
  );
  await expect(client.getAnonymous("https://cdn.example.com/b.webp")).rejects.toBeInstanceOf(
    CrossOriginCloudflareError,
  );

  expect(fetchCount).toBe(1);

  const rejectedWarns = calls.filter(
    (c) => c.level === "warn" && c.fields.event === "fallback_http.cloudflare_rejected",
  );
  // Guards PR #134's no-spam win: the real fetch fires the event once; the
  // short-circuited second call must NOT emit it again.
  expect(rejectedWarns).toHaveLength(1);
});
