import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@plugins/logger/index.ts";
import { CloudflareError, MissingAuthError, createFallbackHttp } from "./index.ts";

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
