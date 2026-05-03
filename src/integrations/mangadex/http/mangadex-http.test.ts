import { describe, expect, test } from "bun:test";
import { createMangaDexHttp } from "@integrations/mangadex/http/index.ts";
import type { FetchFn } from "@integrations/mangadex/http/index.ts";
import type { Config } from "@plugins/config/index.ts";
import type { Logger } from "@plugins/logger/index.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

const noop = (_f: Record<string, unknown>, _m: string) => {};
const noopLogger: Logger = {
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
};

const baseConfig: Config = {
  preferred_languages: ["en"],
  download_quality: "data",
  default_format: "cbz",
  default_out: "./download",
  image_concurrency: 4,
  chapter_delay_ms: 100,
};

function makeSleep() {
  const calls: number[] = [];
  const fn = async (ms: number) => {
    calls.push(ms);
  };
  return { fn, calls };
}

function okFetch(body: unknown): FetchFn {
  return async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

function statusFetch(status: number, headers?: Record<string, string>): FetchFn {
  return async () => new Response(null, { status, headers });
}

function sequenceFetch(responses: Array<() => Response>): FetchFn {
  let i = 0;
  return async () => {
    const fn = responses[i++];
    if (!fn) throw new Error("sequence exhausted");
    return fn();
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("MangaDexHttp.get", () => {
  test("success — returns parsed JSON", async () => {
    const client = createMangaDexHttp({
      logger: noopLogger,
      config: baseConfig,
      fetch: okFetch({ result: "ok", data: [1, 2, 3] }),
    });

    const data = await client.get<{ result: string; data: number[] }>("/manga");
    expect(data).toEqual({ result: "ok", data: [1, 2, 3] });
  });

  test("429 with x-ratelimit-retry-after header — sleeps then succeeds", async () => {
    const sleep = makeSleep();
    const client = createMangaDexHttp({
      logger: noopLogger,
      config: baseConfig,
      sleep: sleep.fn,
      fetch: sequenceFetch([
        () => new Response(null, { status: 429, headers: { "x-ratelimit-retry-after": "2" } }),
        () => new Response(JSON.stringify({ result: "ok" }), { status: 200 }),
      ]),
    });

    const data = await client.get<{ result: string }>("/manga");
    expect(data).toEqual({ result: "ok" });
    // at least one sleep call from the 429
    expect(sleep.calls.length).toBeGreaterThanOrEqual(1);
    // the 429 sleep should be ~2000ms (2s * 1000) ± jitter
    const rateLimitSleep = sleep.calls.find((ms) => ms >= 1900);
    expect(rateLimitSleep).toBeDefined();
  });

  test("429 without header — uses exponential backoff then succeeds", async () => {
    const sleep = makeSleep();
    const client = createMangaDexHttp({
      logger: noopLogger,
      config: baseConfig,
      sleep: sleep.fn,
      fetch: sequenceFetch([
        () => new Response(null, { status: 429 }),
        () => new Response(JSON.stringify({ result: "ok" }), { status: 200 }),
      ]),
    });

    const data = await client.get<{ result: string }>("/manga");
    expect(data).toEqual({ result: "ok" });
    expect(sleep.calls.length).toBeGreaterThanOrEqual(1);
  });

  test("503 — retries then succeeds", async () => {
    const sleep = makeSleep();
    const client = createMangaDexHttp({
      logger: noopLogger,
      config: baseConfig,
      sleep: sleep.fn,
      fetch: sequenceFetch([
        () => new Response(null, { status: 503 }),
        () => new Response(null, { status: 503 }),
        () => new Response(JSON.stringify({ data: "manga" }), { status: 200 }),
      ]),
    });

    const data = await client.get<{ data: string }>("/chapter");
    expect(data).toEqual({ data: "manga" });
    expect(sleep.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("network error — retries then succeeds", async () => {
    const sleep = makeSleep();
    let calls = 0;
    const client = createMangaDexHttp({
      logger: noopLogger,
      config: baseConfig,
      sleep: sleep.fn,
      fetch: async () => {
        calls++;
        if (calls < 3) throw new TypeError("fetch failed");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    const data = await client.get<{ ok: boolean }>("/ping");
    expect(data).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  test("success after retry — 429 then 200", async () => {
    const sleep = makeSleep();
    const client = createMangaDexHttp({
      logger: noopLogger,
      config: baseConfig,
      sleep: sleep.fn,
      fetch: sequenceFetch([
        () => new Response(null, { status: 429, headers: { "retry-after": "1" } }),
        () => new Response(JSON.stringify({ page: 1 }), { status: 200 }),
      ]),
    });

    const data = await client.get<{ page: number }>("/at-home/server/chapter-id");
    expect(data).toEqual({ page: 1 });
  });

  test("exhaustion — 5 network errors throw", async () => {
    const sleep = makeSleep();
    const client = createMangaDexHttp({
      logger: noopLogger,
      config: baseConfig,
      sleep: sleep.fn,
      fetch: async () => {
        throw new TypeError("network down");
      },
    });

    await expect(client.get("/manga")).rejects.toThrow();
    // 5 attempts → 5 sleeps
    expect(sleep.calls.length).toBe(5);
  });

  test("exhaustion — 5 consecutive 503s throw", async () => {
    const sleep = makeSleep();
    const client = createMangaDexHttp({
      logger: noopLogger,
      config: baseConfig,
      sleep: sleep.fn,
      fetch: statusFetch(503),
    });

    await expect(client.get("/manga")).rejects.toThrow("HTTP 503");
    expect(sleep.calls.length).toBe(5);
  });

  test("4xx non-429 — throws immediately without retry", async () => {
    const sleep = makeSleep();
    const client = createMangaDexHttp({
      logger: noopLogger,
      config: baseConfig,
      sleep: sleep.fn,
      fetch: statusFetch(404),
    });

    await expect(client.get("/not-found")).rejects.toThrow("HTTP 404");
    expect(sleep.calls.length).toBe(0);
  });

  test("query params — appended to URL", async () => {
    let capturedUrl = "";
    const client = createMangaDexHttp({
      logger: noopLogger,
      config: baseConfig,
      fetch: async (input) => {
        capturedUrl = typeof input === "string" ? input : (input as Request).url;
        return new Response(JSON.stringify({}), { status: 200 });
      },
    });

    await client.get("/manga", { limit: 10, title: "test", ids: ["a", "b"] });
    const url = new URL(capturedUrl);
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("title")).toBe("test");
    expect(url.searchParams.getAll("ids")).toEqual(["a", "b"]);
  });
});
