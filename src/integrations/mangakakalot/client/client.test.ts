import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FallbackHttpClient } from "@integrations/fallback-http/types.ts";
import type { Logger } from "@plugins/logger/index.ts";
import { createMangakakalotClient } from "./index.ts";
import { parseChapterImages, parseChapterListFromApi, parseSearchResults } from "./parser.ts";
import { MangakakalotParseError } from "./types.ts";

const fixturesDir = join(import.meta.dir, "../../../../tests/fixtures/mangakakalot");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

function readJsonFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf-8"));
}

function makeLogger(): Logger {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as unknown as Logger;
}

function makeHttp(
  responses: Record<string, { body?: string; type?: string; status?: number }>,
): FallbackHttpClient {
  return {
    get: mock(async (url: string) => {
      // strip query params for matching since tests don't include offset
      const baseUrl = url.split("?")[0] ?? url;
      const entry = responses[url] ?? responses[baseUrl];
      if (entry === undefined) throw new Error(`Unexpected URL in test: ${url}`);
      const status = entry.status ?? 200;
      return new Response(entry.body ?? "", {
        status,
        headers: { "content-type": entry.type ?? "text/html" },
      });
    }),
  };
}

// ─── parseSearchResults ───────────────────────────────────────────────────────

describe("parseSearchResults", () => {
  it("returns candidates from search fixture", () => {
    const html = readFixture("search-naruto.html");
    const results = parseSearchResults(html, "https://www.mangakakalot.gg/search/story/naruto");
    expect(results.length).toBe(3);
    expect(results[0]).toMatchObject({
      id: "naruto",
      title: "Naruto",
      originalLanguage: "en",
      year: null,
    });
    expect(results[1]?.id).toBe("naruto-shippuden");
  });

  it("returns empty array when panel_story_list present but empty", () => {
    const html = "<html><body><div class='panel_story_list'></div></body></html>";
    expect(parseSearchResults(html, "https://www.mangakakalot.gg/search/story/test")).toEqual([]);
  });

  it("throws MangakakalotParseError when search container is missing from a live page", () => {
    const html =
      "<html><body><header>Site Header</header><main>Some other content</main></body></html>";
    expect(() =>
      parseSearchResults(html, "https://www.mangakakalot.gg/search/story/naruto"),
    ).toThrow(MangakakalotParseError);
  });

  it("MangakakalotParseError carries the correct url and selector", () => {
    const url = "https://www.mangakakalot.gg/search/story/naruto";
    const html = "<html><body><header>Site Header</header><main>content</main></body></html>";
    let caught: unknown;
    try {
      parseSearchResults(html, url);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MangakakalotParseError);
    const e = caught as MangakakalotParseError;
    expect(e.url).toBe(url);
    expect(e.selector).toContain(".story_item");
  });
});

// ─── parseChapterListFromApi ──────────────────────────────────────────────────

describe("parseChapterListFromApi", () => {
  it("parses real API fixture and returns sorted ascending", () => {
    const json = readJsonFixture("api-chapters-dandadan.json");
    const { chapters } = parseChapterListFromApi(json, "dandadan");

    expect(chapters.length).toBe(3);
    // Sorted ascending by chapter_num
    expect(chapters[0]?.chapter).toBe("1");
    expect(chapters[1]?.chapter).toBe("1.5");
    expect(chapters[2]?.chapter).toBe("3");
  });

  it("composite id is <slug>/<chapter-slug>", () => {
    const json = readJsonFixture("api-chapters-dandadan.json");
    const { chapters } = parseChapterListFromApi(json, "dandadan");
    expect(chapters[0]?.id).toBe("dandadan/chapter-1");
    expect(chapters[1]?.id).toBe("dandadan/chapter-1-5");
  });

  it("decimal chapter_num → string '1.5'", () => {
    const json = {
      success: true,
      data: {
        chapters: [
          {
            chapter_name: "Chapter 1.5",
            chapter_slug: "chapter-1-5",
            chapter_num: 1.5,
            updated_at: "2024-01-01T00:00:00.000000Z",
            view: 0,
          },
        ],
      },
    };
    const { chapters } = parseChapterListFromApi(json, "test");
    expect(chapters[0]?.chapter).toBe("1.5");
  });

  it("empty chapters array → returns empty chapters with hasMore false", () => {
    const json = { success: true, data: { chapters: [] } };
    const { chapters, hasMore } = parseChapterListFromApi(json, "test");
    expect(chapters).toEqual([]);
    expect(hasMore).toBe(false);
  });

  it("missing success:true → throws MangakakalotParseError", () => {
    const json = { success: false, data: { chapters: [] } };
    expect(() => parseChapterListFromApi(json, "test")).toThrow(MangakakalotParseError);
  });

  it("missing data.chapters → throws MangakakalotParseError", () => {
    const json = { success: true, data: {} };
    expect(() => parseChapterListFromApi(json, "test")).toThrow(MangakakalotParseError);
  });

  it("sorts descending-order input to ascending output", () => {
    const json = {
      success: true,
      data: {
        chapters: [
          {
            chapter_name: "Chapter 3",
            chapter_slug: "chapter-3",
            chapter_num: 3,
            updated_at: "2024-03-01T00:00:00.000000Z",
            view: 0,
          },
          {
            chapter_name: "Chapter 1",
            chapter_slug: "chapter-1",
            chapter_num: 1,
            updated_at: "2024-01-01T00:00:00.000000Z",
            view: 0,
          },
          {
            chapter_name: "Chapter 2",
            chapter_slug: "chapter-2",
            chapter_num: 2,
            updated_at: "2024-02-01T00:00:00.000000Z",
            view: 0,
          },
        ],
      },
    };
    const { chapters } = parseChapterListFromApi(json, "test");
    expect(chapters.map((c) => c.chapter)).toEqual(["1", "2", "3"]);
  });

  it("title is null when chapter_name has no subtitle after stripping label", () => {
    const json = {
      success: true,
      data: {
        chapters: [
          {
            chapter_name: "Chapter 1",
            chapter_slug: "chapter-1",
            chapter_num: 1,
            updated_at: "2024-01-01T00:00:00.000000Z",
            view: 0,
          },
        ],
      },
    };
    const { chapters } = parseChapterListFromApi(json, "test");
    expect(chapters[0]?.title).toBeNull();
  });

  it("readableAt is the updated_at ISO string verbatim", () => {
    const json = readJsonFixture("api-chapters-dandadan.json");
    const { chapters } = parseChapterListFromApi(json, "dandadan");
    expect(chapters[0]?.readableAt).toBe("2024-01-01T00:00:00.000000Z");
  });

  it("returns hasMore true when pagination.has_more is true", () => {
    const json = {
      success: true,
      data: {
        chapters: [
          {
            chapter_name: "Chapter 1",
            chapter_slug: "chapter-1",
            chapter_num: 1,
            updated_at: "2024-01-01T00:00:00.000000Z",
            view: 0,
          },
        ],
        pagination: { total: 100, limit: 50, offset: 0, has_more: true },
      },
    };
    const { hasMore, limit } = parseChapterListFromApi(json, "test");
    expect(hasMore).toBe(true);
    expect(limit).toBe(50);
  });
});

// ─── parseChapterImages ───────────────────────────────────────────────────────

describe("parseChapterImages", () => {
  it("parses images from chapter fixture, preferring data-src", () => {
    const html = readFixture("chapter-naruto-1.html");
    const images = parseChapterImages(html, "https://www.mangakakalot.gg/chapter/naruto/chapter-1");
    expect(images.length).toBe(3);
    // Page 1: both src and data-src — data-src wins
    expect(images[0]).toEqual({ url: "https://cdn.example.com/naruto/ch1/page-1.jpg", page: 1 });
    // Page 2: src only
    expect(images[1]).toEqual({ url: "https://cdn.example.com/naruto/ch1/page-2.jpg", page: 2 });
    // Page 3: data-src only
    expect(images[2]).toEqual({ url: "https://cdn.example.com/naruto/ch1/page-3.jpg", page: 3 });
  });

  it("parses real Dandadan chapter-1 fixture and finds 65+ images", () => {
    const html = readFixture("real-chapter-dandadan-1.html");
    const images = parseChapterImages(html, "https://www.mangakakalot.gg/manga/dandadan/chapter-1");
    // 65 pages (0.webp–64.webp); some CDN ad imgs may be included
    expect(images.length).toBeGreaterThanOrEqual(65);
    expect(images[0]?.url).toBe("https://img-r1.2xstorage.com/dandadan/1/0.webp");
  });

  it("throws MangakakalotParseError when reader container has no images", () => {
    const url = "https://www.mangakakalot.gg/chapter/naruto/chapter-1";
    const html = "<html><body><div class='container-chapter-reader'></div></body></html>";
    expect(() => parseChapterImages(html, url)).toThrow(MangakakalotParseError);
  });

  it("MangakakalotParseError from images carries url and selector", () => {
    const url = "https://www.mangakakalot.gg/chapter/naruto/chapter-1";
    const html = "<html><body>404 not found</body></html>";
    let caught: unknown;
    try {
      parseChapterImages(html, url);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MangakakalotParseError);
    const e = caught as MangakakalotParseError;
    expect(e.url).toBe(url);
    expect(e.selector).toContain(".container-chapter-reader");
  });

  it("handles src-only images", () => {
    const html = `
      <div class="container-chapter-reader">
        <img src="https://cdn.example.com/p1.jpg" />
        <img src="https://cdn.example.com/p2.jpg" />
      </div>`;
    const images = parseChapterImages(html, "https://www.mangakakalot.gg/chapter/test/chapter-1");
    expect(images).toEqual([
      { url: "https://cdn.example.com/p1.jpg", page: 1 },
      { url: "https://cdn.example.com/p2.jpg", page: 2 },
    ]);
  });

  it("handles data-src-only images", () => {
    const html = `
      <div class="container-chapter-reader">
        <img data-src="https://cdn.example.com/lazy.jpg" />
      </div>`;
    const images = parseChapterImages(html, "https://www.mangakakalot.gg/chapter/test/chapter-1");
    expect(images).toEqual([{ url: "https://cdn.example.com/lazy.jpg", page: 1 }]);
  });
});

// ─── MangakakalotClient ───────────────────────────────────────────────────────

describe("createMangakakalotClient", () => {
  describe("searchManga", () => {
    it("fetches search URL and returns parsed results", async () => {
      const html = readFixture("search-naruto.html");
      const http = makeHttp({ "https://www.mangakakalot.gg/search/story/naruto": { body: html } });
      const logger = makeLogger();
      const client = createMangakakalotClient({ http, logger });

      const results = await client.searchManga("naruto");
      expect(results.length).toBe(3);
      expect(results[0]?.id).toBe("naruto");
      // @ts-ignore — logger is a mock
      expect(logger.info).toHaveBeenCalledTimes(1);
    });

    it("encodes multi-word title with underscores", async () => {
      const http = makeHttp({
        "https://www.mangakakalot.gg/search/story/one_piece": {
          body: "<html><body><div class='panel_story_list'></div></body></html>",
        },
      });
      const client = createMangakakalotClient({ http, logger: makeLogger() });
      const results = await client.searchManga("One Piece");
      expect(results).toEqual([]);
    });

    it("propagates CloudflareError from http.get without swallowing", async () => {
      const { CloudflareError } = await import("@integrations/fallback-http/types.ts");
      const http: FallbackHttpClient = {
        get: mock(async () => {
          throw new CloudflareError("https://www.mangakakalot.gg/search/story/naruto");
        }),
      };
      const client = createMangakakalotClient({ http, logger: makeLogger() });
      await expect(client.searchManga("naruto")).rejects.toBeInstanceOf(CloudflareError);
    });

    it("logs warn and propagates MangakakalotParseError when DOM is broken", async () => {
      const brokenHtml =
        "<html><body><header>Site Header</header><main>Completely different layout</main></body></html>";
      const url = "https://www.mangakakalot.gg/search/story/naruto";
      const http = makeHttp({ [url]: { body: brokenHtml } });
      const logger = makeLogger();
      const client = createMangakakalotClient({ http, logger });

      await expect(client.searchManga("naruto")).rejects.toBeInstanceOf(MangakakalotParseError);
      // @ts-ignore
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "mangakakalot.parse_failed" }),
        expect.any(String),
      );
    });
  });

  describe("getChapterList", () => {
    it("calls the JSON API endpoint and returns chapters sorted ascending", async () => {
      const apiBody = readFixture("api-chapters-dandadan.json");
      const http = makeHttp({
        "https://www.mangakakalot.gg/api/manga/dandadan/chapters": {
          body: apiBody,
          type: "application/json",
        },
      });
      const logger = makeLogger();
      const client = createMangakakalotClient({ http, logger });

      const chapters = await client.getChapterList("dandadan");
      expect(chapters.length).toBe(3);
      expect(chapters[0]?.chapter).toBe("1");
      expect(chapters[2]?.chapter).toBe("3");
    });

    it("sends accept: application/json header", async () => {
      let capturedHeaders: Record<string, string> | undefined;
      const http: FallbackHttpClient = {
        get: mock(async (_url: string, headers?: Record<string, string>) => {
          capturedHeaders = headers;
          return new Response(JSON.stringify({ success: true, data: { chapters: [] } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }),
      };
      const client = createMangakakalotClient({ http, logger: makeLogger() });
      await client.getChapterList("dandadan");
      expect(capturedHeaders?.accept).toBe("application/json");
    });

    it("follows API pagination when has_more is true", async () => {
      const page1 = JSON.stringify({
        success: true,
        data: {
          chapters: [
            {
              chapter_name: "Chapter 2",
              chapter_slug: "chapter-2",
              chapter_num: 2,
              updated_at: "2024-02-01T00:00:00.000000Z",
              view: 0,
            },
            {
              chapter_name: "Chapter 1",
              chapter_slug: "chapter-1",
              chapter_num: 1,
              updated_at: "2024-01-01T00:00:00.000000Z",
              view: 0,
            },
          ],
          pagination: { total: 3, limit: 2, offset: 0, has_more: true },
        },
      });
      const page2 = JSON.stringify({
        success: true,
        data: {
          chapters: [
            {
              chapter_name: "Chapter 3",
              chapter_slug: "chapter-3",
              chapter_num: 3,
              updated_at: "2024-03-01T00:00:00.000000Z",
              view: 0,
            },
          ],
          pagination: { total: 3, limit: 2, offset: 2, has_more: false },
        },
      });

      const http: FallbackHttpClient = {
        get: mock(async (url: string) => {
          const body = url.includes("offset=2") ? page2 : page1;
          return new Response(body, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }),
      };
      const client = createMangakakalotClient({ http, logger: makeLogger() });
      const chapters = await client.getChapterList("test");
      expect(chapters.map((c) => c.chapter)).toEqual(["1", "2", "3"]);
      // @ts-ignore
      expect(http.get).toHaveBeenCalledTimes(2);
    });

    it("propagates CloudflareError without swallowing", async () => {
      const { CloudflareError } = await import("@integrations/fallback-http/types.ts");
      const http: FallbackHttpClient = {
        get: mock(async () => {
          throw new CloudflareError("https://www.mangakakalot.gg/api/manga/naruto/chapters");
        }),
      };
      const client = createMangakakalotClient({ http, logger: makeLogger() });
      await expect(client.getChapterList("naruto")).rejects.toBeInstanceOf(CloudflareError);
    });

    it("non-200 from chapters API logs warn and throws MangakakalotParseError", async () => {
      const http = makeHttp({
        "https://www.mangakakalot.gg/api/manga/dandadan/chapters": { status: 503 },
      });
      const logger = makeLogger();
      const client = createMangakakalotClient({ http, logger });

      await expect(client.getChapterList("dandadan")).rejects.toBeInstanceOf(
        MangakakalotParseError,
      );
      // @ts-ignore
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "mangakakalot.chapters_api_error", status: 503 }),
        expect.any(String),
      );
    });

    it("throws MangakakalotParseError when API returns invalid JSON shape", async () => {
      const http = makeHttp({
        "https://www.mangakakalot.gg/api/manga/test-manga/chapters": {
          body: '{"success":false}',
          type: "application/json",
        },
      });
      const logger = makeLogger();
      const client = createMangakakalotClient({ http, logger });

      await expect(client.getChapterList("test-manga")).rejects.toBeInstanceOf(
        MangakakalotParseError,
      );
      // @ts-ignore
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "mangakakalot.parse_failed" }),
        expect.any(String),
      );
    });
  });

  describe("getChapterImages", () => {
    it("accepts a full URL", async () => {
      const html = readFixture("chapter-naruto-1.html");
      const http = makeHttp({
        "https://www.mangakakalot.gg/chapter/naruto/chapter-1": { body: html },
      });
      const client = createMangakakalotClient({ http, logger: makeLogger() });

      const images = await client.getChapterImages(
        "https://www.mangakakalot.gg/chapter/naruto/chapter-1",
      );
      expect(images.length).toBe(3);
    });

    it("accepts a new composite id <mangaSlug>/<chapter-slug>", async () => {
      const html = readFixture("chapter-naruto-1.html");
      const http = makeHttp({
        "https://www.mangakakalot.gg/manga/naruto/chapter-1": { body: html },
      });
      const client = createMangakakalotClient({ http, logger: makeLogger() });

      const images = await client.getChapterImages("naruto/chapter-1");
      expect(images.length).toBe(3);
    });

    it("accepts a legacy path-style id chapter/...", async () => {
      const html = readFixture("chapter-naruto-1.html");
      const http = makeHttp({
        "https://www.mangakakalot.gg/chapter/naruto/chapter-1": { body: html },
      });
      const client = createMangakakalotClient({ http, logger: makeLogger() });

      const images = await client.getChapterImages("chapter/naruto/chapter-1");
      expect(images.length).toBe(3);
    });

    it("logs mangakakalot.fetch event", async () => {
      const html = readFixture("chapter-naruto-1.html");
      const http = makeHttp({
        "https://www.mangakakalot.gg/manga/naruto/chapter-1": { body: html },
      });
      const logger = makeLogger();
      const client = createMangakakalotClient({ http, logger });

      await client.getChapterImages("naruto/chapter-1");
      // @ts-ignore
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ event: "mangakakalot.fetch" }),
        expect.any(String),
      );
    });

    it("propagates CloudflareError from http.get without swallowing", async () => {
      const { CloudflareError } = await import("@integrations/fallback-http/types.ts");
      const http: FallbackHttpClient = {
        get: mock(async () => {
          throw new CloudflareError("https://www.mangakakalot.gg/manga/naruto/chapter-1");
        }),
      };
      const client = createMangakakalotClient({ http, logger: makeLogger() });
      await expect(client.getChapterImages("naruto/chapter-1")).rejects.toBeInstanceOf(
        CloudflareError,
      );
    });

    it("logs warn and propagates MangakakalotParseError when reader has no images", async () => {
      const brokenHtml = "<html><body><div class='container-chapter-reader'></div></body></html>";
      const url = "https://www.mangakakalot.gg/chapter/naruto/chapter-1";
      const http = makeHttp({ [url]: { body: brokenHtml } });
      const logger = makeLogger();
      const client = createMangakakalotClient({ http, logger });

      await expect(client.getChapterImages(url)).rejects.toBeInstanceOf(MangakakalotParseError);
      // @ts-ignore
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "mangakakalot.parse_failed" }),
        expect.any(String),
      );
    });
  });
});
