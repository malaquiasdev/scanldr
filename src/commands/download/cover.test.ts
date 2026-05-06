import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { MAX_COVER_BYTES, fetchCover } from "./cover.ts";

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

// Minimal fake auth.json used to assert cookie/UA headers are forwarded
const FAKE_AUTH: Record<string, unknown> = {
  cookies: { _session: "abc123", __cf_bm: "xyz" },
  userAgent: "FakeUA/1.0",
  savedAt: 1700000000000,
};

function makeResponse(opts: {
  status: number;
  contentType?: string;
  body?: Uint8Array | ArrayBuffer;
}): Response {
  const headers = new Headers();
  if (opts.contentType) headers.set("content-type", opts.contentType);
  return new Response(opts.body ?? new Uint8Array([0xff, 0xd8]), {
    status: opts.status,
    headers,
  });
}

/** Cast a simple async function to FetchFn — avoids the TS preconnect property error */
function asFetch(fn: (url: string, init?: RequestInit) => Promise<Response>): FetchFn {
  return fn as unknown as FetchFn;
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

describe("fetchCover — URL validation", () => {
  test("file:// scheme is rejected", async () => {
    await expect(fetchCover("file:///etc/passwd")).rejects.toThrow("Only http(s) URLs allowed");
  });

  test("data: scheme is rejected", async () => {
    await expect(fetchCover("data:image/png;base64,abc")).rejects.toThrow("Only http(s) URLs allowed");
  });

  test("totally invalid URL is rejected", async () => {
    await expect(fetchCover("not-a-url")).rejects.toThrow("Invalid URL");
  });
});

// ---------------------------------------------------------------------------
// HTTP status validation
// ---------------------------------------------------------------------------

describe("fetchCover — HTTP status", () => {
  test("404 throws Cover fetch failed: HTTP 404", async () => {
    const mockFetch = asFetch(async () => makeResponse({ status: 404, contentType: "text/html" }));
    await expect(fetchCover("https://example.com/cover.jpg", { fetch: mockFetch })).rejects.toThrow(
      "Cover fetch failed: HTTP 404",
    );
  });

  test("500 throws Cover fetch failed: HTTP 500", async () => {
    const mockFetch = asFetch(async () => makeResponse({ status: 500, contentType: "text/html" }));
    await expect(fetchCover("https://example.com/cover.jpg", { fetch: mockFetch })).rejects.toThrow(
      "Cover fetch failed: HTTP 500",
    );
  });

  test("network error (fetch throws) produces useful message", async () => {
    const mockFetch = asFetch(async (): Promise<Response> => {
      throw new Error("ECONNREFUSED");
    });
    await expect(fetchCover("https://example.com/cover.jpg", { fetch: mockFetch })).rejects.toThrow(
      "Cover fetch failed: ECONNREFUSED",
    );
  });
});

// ---------------------------------------------------------------------------
// Content-Type validation
// ---------------------------------------------------------------------------

describe("fetchCover — Content-Type", () => {
  test("text/html content-type is rejected", async () => {
    const mockFetch = asFetch(async () => makeResponse({ status: 200, contentType: "text/html" }));
    await expect(fetchCover("https://example.com/cover.jpg", { fetch: mockFetch })).rejects.toThrow(
      "URL did not return an image (got text/html)",
    );
  });

  test("image/bmp content-type is rejected (unsupported format)", async () => {
    const mockFetch = asFetch(async () => makeResponse({ status: 200, contentType: "image/bmp" }));
    await expect(fetchCover("https://example.com/cover.jpg", { fetch: mockFetch })).rejects.toThrow(
      "URL did not return an image (got image/bmp)",
    );
  });
});

// ---------------------------------------------------------------------------
// Size validation
// ---------------------------------------------------------------------------

describe("fetchCover — size limit", () => {
  test("body exceeding MAX_COVER_BYTES is rejected", async () => {
    const oversized = new Uint8Array(MAX_COVER_BYTES + 1);
    const mockFetch = asFetch(async () =>
      makeResponse({ status: 200, contentType: "image/jpeg", body: oversized }),
    );
    await expect(fetchCover("https://example.com/cover.jpg", { fetch: mockFetch })).rejects.toThrow(
      /Cover too large/,
    );
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("fetchCover — happy path", () => {
  const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);

  test("image/jpeg → ext .jpg, correct bytes returned", async () => {
    const mockFetch = asFetch(async () =>
      makeResponse({ status: 200, contentType: "image/jpeg", body: JPEG_BYTES }),
    );
    const result = await fetchCover("https://example.com/cover.jpg", { fetch: mockFetch });
    expect(result.ext).toBe(".jpg");
    expect(result.bytes).toEqual(JPEG_BYTES);
  });

  test("image/png → ext .png", async () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const mockFetch = asFetch(async () =>
      makeResponse({ status: 200, contentType: "image/png", body: PNG }),
    );
    const result = await fetchCover("https://example.com/cover.png", { fetch: mockFetch });
    expect(result.ext).toBe(".png");
  });

  test("image/webp → ext .webp", async () => {
    const mockFetch = asFetch(async () =>
      makeResponse({ status: 200, contentType: "image/webp", body: new Uint8Array([0x52, 0x49]) }),
    );
    const result = await fetchCover("https://example.com/cover.webp", { fetch: mockFetch });
    expect(result.ext).toBe(".webp");
  });

  test("image/gif → ext .gif", async () => {
    const mockFetch = asFetch(async () =>
      makeResponse({ status: 200, contentType: "image/gif", body: new Uint8Array([0x47, 0x49]) }),
    );
    const result = await fetchCover("https://example.com/cover.gif", { fetch: mockFetch });
    expect(result.ext).toBe(".gif");
  });

  test("content-type with charset param is handled (image/jpeg; charset=...)", async () => {
    const mockFetch = asFetch(async () =>
      makeResponse({ status: 200, contentType: "image/jpeg; charset=utf-8", body: JPEG_BYTES }),
    );
    const result = await fetchCover("https://example.com/cover.jpg", { fetch: mockFetch });
    expect(result.ext).toBe(".jpg");
  });
});

// ---------------------------------------------------------------------------
// Auth integration
// ---------------------------------------------------------------------------

describe("fetchCover — auth.json integration", () => {
  test("cookies + UA from auth.json are sent in the request", async () => {
    // Write a real auth.json to a temp dir
    const dir = join(tmpdir(), `cover-auth-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const authPath = join(dir, "auth.json");
    await writeFile(authPath, JSON.stringify(FAKE_AUTH));

    const capturedHeaders: Record<string, string> = {};
    const mockFetch = asFetch(async (_url: string, init?: RequestInit) => {
      const h = init?.headers as Record<string, string> | undefined;
      if (h) Object.assign(capturedHeaders, h);
      return makeResponse({ status: 200, contentType: "image/jpeg" });
    });

    await fetchCover("https://example.com/cover.jpg", { fetch: mockFetch, authPath });

    expect(capturedHeaders["user-agent"]).toBe("FakeUA/1.0");
    expect(capturedHeaders["cookie"]).toContain("_session=abc123");
    expect(capturedHeaders["cookie"]).toContain("__cf_bm=xyz");
  });

  test("missing auth.json falls back to bare UA without throwing", async () => {
    const mockFetch = asFetch(async (_url: string, init?: RequestInit) => {
      const h = init?.headers as Record<string, string> | undefined;
      // Should have a user-agent but no cookie
      expect(h?.["user-agent"]).toBeDefined();
      expect(h?.["cookie"]).toBeUndefined();
      return makeResponse({ status: 200, contentType: "image/jpeg" });
    });

    // Point to a path that definitely doesn't exist
    const result = await fetchCover("https://example.com/cover.jpg", {
      fetch: mockFetch,
      authPath: "/nonexistent/path/auth.json",
    });

    expect(result.ext).toBe(".jpg");
  });
});
