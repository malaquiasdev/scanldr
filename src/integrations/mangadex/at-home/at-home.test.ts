import { describe, expect, it, mock } from "bun:test";
import type { MangaDexHttpClient } from "@integrations/mangadex/http/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import { getAtHomeServer, mangadexImageFetcher } from "./index.ts";
import type { AtHomeOptions } from "./types.ts";

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeHttpClient(overrides?: Partial<MangaDexHttpClient>): MangaDexHttpClient {
  return {
    get: async <T>(_path: string) => {
      return {
        baseUrl: "https://cdn.example.com",
        chapter: {
          hash: "abc123",
          data: ["page1.jpg", "page2.jpg"],
          dataSaver: ["page1-saver.jpg", "page2-saver.jpg"],
        },
      } as T;
    },
    ...overrides,
  };
}

function makeImageResponse(opts: {
  ok: boolean;
  status?: number;
  xCache?: string;
  bytes?: Uint8Array;
}): Response {
  const bytes = opts.bytes ?? new Uint8Array([1, 2, 3]);
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    headers: {
      get: (key: string) => (key === "x-cache" ? (opts.xCache ?? null) : null),
    },
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response;
}

// ---------- getAtHomeServer ----------

describe("getAtHomeServer", () => {
  it("returns baseUrl, hash, and data pages for quality=data", async () => {
    const client = makeHttpClient();
    const result = await getAtHomeServer(client, "ch-001", "data");
    expect(result.baseUrl).toBe("https://cdn.example.com");
    expect(result.hash).toBe("abc123");
    expect(result.pages).toEqual(["page1.jpg", "page2.jpg"]);
  });

  it("returns dataSaver pages for quality=data-saver", async () => {
    const client = makeHttpClient();
    const result = await getAtHomeServer(client, "ch-001", "data-saver");
    expect(result.pages).toEqual(["page1-saver.jpg", "page2-saver.jpg"]);
  });
});

// ---------- mangadexImageFetcher — success path ----------

describe("mangadexImageFetcher — success path", () => {
  it("returns image bytes on first attempt", async () => {
    const imageBytes = new Uint8Array([10, 20, 30]);
    const mockFetch = mock(async (_url: string) =>
      makeImageResponse({ ok: true, bytes: imageBytes }),
    );
    const opts: AtHomeOptions = {
      httpClient: makeHttpClient(),
      logger: noopLogger,
      fetch: mockFetch as unknown as AtHomeOptions["fetch"],
      sleep: async () => {},
    };
    const fetcher = mangadexImageFetcher("ch-001", opts);
    const result = await fetcher({ url: "", page: 1 });
    expect(result).toEqual(imageBytes);
  });

  it("sends a success report after a successful fetch", async () => {
    const reportPayloads: unknown[] = [];
    const mockFetch = mock(async (url: string, init?: RequestInit) => {
      if (url === "https://api.mangadex.network/report") {
        reportPayloads.push(JSON.parse(init?.body as string));
        return new Response(null, { status: 200 });
      }
      return makeImageResponse({ ok: true, xCache: "HIT from server" });
    });
    const opts: AtHomeOptions = {
      httpClient: makeHttpClient(),
      logger: noopLogger,
      fetch: mockFetch as unknown as AtHomeOptions["fetch"],
      sleep: async () => {},
    };
    const fetcher = mangadexImageFetcher("ch-001", opts);
    await fetcher({ url: "", page: 1 });

    // allow microtask queue to flush the fire-and-forget report
    await Promise.resolve();
    expect(reportPayloads.length).toBe(1);
    const report = reportPayloads[0] as Record<string, unknown>;
    expect(report.success).toBe(true);
    expect(report.cached).toBe(true);
    expect(typeof report.bytes).toBe("number");
    expect(typeof report.duration).toBe("number");
    expect(typeof report.url).toBe("string");
  });
});

// ---------- stale CDN retry ----------

describe("mangadexImageFetcher — stale CDN retry", () => {
  it("re-fetches /at-home/server on every failure before retrying", async () => {
    let atHomeCallCount = 0;
    const httpClient = makeHttpClient({
      get: async <T>(_path: string) => {
        atHomeCallCount++;
        return {
          baseUrl: "https://cdn.example.com",
          chapter: { hash: "abc123", data: ["page1.jpg"], dataSaver: [] },
        } as T;
      },
    });

    let imageFetchCount = 0;
    const mockFetch = mock(async (url: string) => {
      if (url === "https://api.mangadex.network/report") return new Response(null, { status: 200 });
      imageFetchCount++;
      // fail first 2 attempts, succeed on 3rd
      return makeImageResponse({ ok: imageFetchCount >= 3 });
    });

    const opts: AtHomeOptions = {
      httpClient,
      logger: noopLogger,
      fetch: mockFetch as unknown as AtHomeOptions["fetch"],
      sleep: async () => {},
    };

    const fetcher = mangadexImageFetcher("ch-001", opts);
    await fetcher({ url: "", page: 1 });

    // at-home server is called once per attempt (3 successful on 3rd)
    expect(atHomeCallCount).toBe(3);
    expect(imageFetchCount).toBe(3);
  });
});

// ---------- all 5 attempts fail ----------

describe("mangadexImageFetcher — all attempts fail", () => {
  it("throws after 5 attempts", async () => {
    let imageFetchCount = 0;
    const mockFetch = mock(async (url: string) => {
      if (url === "https://api.mangadex.network/report") return new Response(null, { status: 200 });
      imageFetchCount++;
      return makeImageResponse({ ok: false, status: 503 });
    });

    const opts: AtHomeOptions = {
      httpClient: makeHttpClient(),
      logger: noopLogger,
      fetch: mockFetch as unknown as AtHomeOptions["fetch"],
      sleep: async () => {},
    };

    const fetcher = mangadexImageFetcher("ch-001", opts);
    await expect(fetcher({ url: "", page: 1 })).rejects.toThrow();
    expect(imageFetchCount).toBe(5);
  });
});

// ---------- report HTTP failure tolerated ----------

describe("mangadexImageFetcher — report failure tolerated", () => {
  it("does not throw when the report POST fails", async () => {
    const warnMessages: string[] = [];
    const warnLogger: Logger = {
      ...noopLogger,
      warn: (_fields, msg) => warnMessages.push(msg),
    };

    const mockFetch = mock(async (url: string) => {
      if (url === "https://api.mangadex.network/report") {
        throw new Error("network failure on report");
      }
      return makeImageResponse({ ok: true });
    });

    const opts: AtHomeOptions = {
      httpClient: makeHttpClient(),
      logger: warnLogger,
      fetch: mockFetch as unknown as AtHomeOptions["fetch"],
      sleep: async () => {},
    };

    const fetcher = mangadexImageFetcher("ch-001", opts);
    // Should resolve without throwing even though report POST throws
    const result = await fetcher({ url: "", page: 1 });
    expect(result).toBeInstanceOf(Uint8Array);

    // allow microtask queue to flush
    await Promise.resolve();
    expect(warnMessages.some((m) => m.includes("report"))).toBe(true);
  });
});
