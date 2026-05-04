import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FallbackHttpClient } from "@integrations/fallback-http/types.ts";
import type { Logger } from "@plugins/logger/index.ts";
import { createMangakakalotClient } from "./index.ts";
import {
  parseChapterImages,
  parseChapterList,
  parseChapterListPagination,
  parseSearchResults,
} from "./parser.ts";
import { MangakakalotParseError } from "./types.ts";

const fixturesDir = join(import.meta.dir, "../../../../tests/fixtures/mangakakalot");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

function makeLogger(): Logger {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as unknown as Logger;
}

function makeHttp(responses: Record<string, string>): FallbackHttpClient {
  return {
    get: mock(async (url: string) => {
      const body = responses[url];
      if (body === undefined) throw new Error(`Unexpected URL in test: ${url}`);
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    }),
  };
}

// ─── parseSearchResults ───────────────────────────────────────────────────────

describe("parseSearchResults", () => {
  it("returns candidates from search fixture", () => {
    const html = readFixture("search-naruto.html");
    const results = parseSearchResults(html);
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
    expect(parseSearchResults(html)).toEqual([]);
  });

  it("throws MangakakalotParseError when search container is missing from a live page", () => {
    // A real page body with no search container = DOM drifted, not "no results"
    const html =
      "<html><body><header>Site Header</header><main>Some other content</main></body></html>";
    expect(() => parseSearchResults(html, "https://mangakakalot.gg/search/story/naruto")).toThrow(
      MangakakalotParseError,
    );
  });

  it("MangakakalotParseError carries the correct url and selector", () => {
    const url = "https://mangakakalot.gg/search/story/naruto";
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

// ─── parseChapterList ─────────────────────────────────────────────────────────

describe("parseChapterList", () => {
  it("parses chapter list from manga fixture", () => {
    const html = readFixture("manga-naruto.html");
    const chapters = parseChapterList(html, "naruto");
    expect(chapters.length).toBe(3);

    if (!chapters[0]) throw new Error("Expected chapter at index 0");
    const ch700 = chapters[0];
    expect(ch700.chapter).toBe("700");
    expect(ch700.volume).toBeNull();
    expect(ch700.translatedLanguage).toBe("en");
    expect(ch700.scanlationGroup).toBeNull();
    expect(ch700.externalUrl).toBeNull();
    expect(ch700.readableAt).toBe(new Date("Dec 10, 2014 00:00").toISOString());
    expect(ch700.id).toContain("chapter/naruto/chapter-700");
  });

  it("returns single chapter correctly", () => {
    const html = `
      <div class="chapter-list">
        <div class="row">
          <span><a href="https://mangakakalot.gg/chapter/test/chapter-1">Chapter 1</a></span>
          <span title="Jan 01, 2020 00:00">Jan 01,2020</span>
        </div>
      </div>`;
    const chapters = parseChapterList(html, "test");
    expect(chapters.length).toBe(1);
    expect(chapters[0]?.chapter).toBe("1");
  });

  it("returns empty array when chapter rows absent but title present (manga has no releases)", () => {
    // Title present + no chapter rows = valid empty state
    const html = "<html><body><div class='manga-info-text'><h1>Test Manga</h1></div></body></html>";
    expect(parseChapterList(html, "test-manga")).toEqual([]);
  });

  it("throws MangakakalotParseError when both chapter list and title selectors are missing", () => {
    const url = "https://mangakakalot.gg/manga/test-manga";
    const html = "<html><body>404 not found</body></html>";
    expect(() => parseChapterList(html, "test-manga", url)).toThrow(MangakakalotParseError);
  });

  it("MangakakalotParseError from chapter list carries url and selector", () => {
    const url = "https://mangakakalot.gg/manga/test-manga";
    const html = "<html><body>404 not found</body></html>";
    let caught: unknown;
    try {
      parseChapterList(html, "test-manga", url);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MangakakalotParseError);
    const e = caught as MangakakalotParseError;
    expect(e.url).toBe(url);
    expect(e.selector).toContain(".chapter-list");
  });

  it("uses epoch when date is missing", () => {
    const html = `
      <div class="chapter-list">
        <div class="row">
          <span><a href="https://mangakakalot.gg/chapter/test/chapter-5">Chapter 5</a></span>
          <span></span>
        </div>
      </div>`;
    const chapters = parseChapterList(html, "test");
    expect(chapters[0]?.readableAt).toBe(new Date(0).toISOString());
  });
});

// ─── parseChapterImages ───────────────────────────────────────────────────────

describe("parseChapterImages", () => {
  it("parses images from chapter fixture, preferring data-src", () => {
    const html = readFixture("chapter-naruto-1.html");
    const images = parseChapterImages(html);
    expect(images.length).toBe(3);
    // Page 1: both src and data-src — data-src wins
    expect(images[0]).toEqual({ url: "https://cdn.example.com/naruto/ch1/page-1.jpg", page: 1 });
    // Page 2: src only
    expect(images[1]).toEqual({ url: "https://cdn.example.com/naruto/ch1/page-2.jpg", page: 2 });
    // Page 3: data-src only
    expect(images[2]).toEqual({ url: "https://cdn.example.com/naruto/ch1/page-3.jpg", page: 3 });
  });

  it("throws MangakakalotParseError when reader container has no images", () => {
    const url = "https://mangakakalot.gg/chapter/naruto/chapter-1";
    const html = "<html><body><div class='container-chapter-reader'></div></body></html>";
    expect(() => parseChapterImages(html, url)).toThrow(MangakakalotParseError);
  });

  it("MangakakalotParseError from images carries url and selector", () => {
    const url = "https://mangakakalot.gg/chapter/naruto/chapter-1";
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
    const images = parseChapterImages(html);
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
    const images = parseChapterImages(html);
    expect(images).toEqual([{ url: "https://cdn.example.com/lazy.jpg", page: 1 }]);
  });
});

// ─── parseChapterListPagination ───────────────────────────────────────────────

describe("parseChapterListPagination", () => {
  it("returns next URL from paginated fixture", () => {
    const html = readFixture("manga-paginated.html");
    const next = parseChapterListPagination(html);
    expect(next).toBe("https://mangakakalot.gg/manga/bleach?page=2");
  });

  it("returns null when no pagination panel", () => {
    expect(parseChapterListPagination("<html><body></body></html>")).toBeNull();
  });

  it("returns null when no next page link after active page (last page)", () => {
    const html = `
      <div class="panel_page_number">
        <a href="/manga/test?page=1">1</a>
        <a href="/manga/test?page=2" class="page_select">2</a>
      </div>`;
    expect(parseChapterListPagination(html)).toBeNull();
  });
});

// ─── MangakakalotClient ───────────────────────────────────────────────────────

describe("createMangakakalotClient", () => {
  describe("searchManga", () => {
    it("fetches search URL and returns parsed results", async () => {
      const html = readFixture("search-naruto.html");
      const http = makeHttp({ "https://mangakakalot.gg/search/story/naruto": html });
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
        "https://mangakakalot.gg/search/story/one_piece":
          "<html><body><div class='panel_story_list'></div></body></html>",
      });
      const client = createMangakakalotClient({ http, logger: makeLogger() });
      const results = await client.searchManga("One Piece");
      expect(results).toEqual([]);
    });

    it("propagates CloudflareError from http.get without swallowing", async () => {
      const { CloudflareError } = await import("@integrations/fallback-http/types.ts");
      const http: FallbackHttpClient = {
        get: mock(async () => {
          throw new CloudflareError("https://mangakakalot.gg/search/story/naruto");
        }),
      };
      const client = createMangakakalotClient({ http, logger: makeLogger() });
      await expect(client.searchManga("naruto")).rejects.toBeInstanceOf(CloudflareError);
    });

    it("logs warn and propagates MangakakalotParseError when DOM is broken", async () => {
      // Broken page: has body content but no search results container
      const brokenHtml =
        "<html><body><header>Site Header</header><main>Completely different layout</main></body></html>";
      const url = "https://mangakakalot.gg/search/story/naruto";
      const http = makeHttp({ [url]: brokenHtml });
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
    it("returns chapters from a single-page manga", async () => {
      const html = readFixture("manga-naruto.html");
      const http = makeHttp({ "https://mangakakalot.gg/manga/naruto": html });
      const logger = makeLogger();
      const client = createMangakakalotClient({ http, logger });

      const chapters = await client.getChapterList("naruto");
      expect(chapters.length).toBe(3);
      // @ts-ignore
      expect(logger.info).toHaveBeenCalledTimes(1);
    });

    it("follows pagination and concatenates chapters", async () => {
      const page1 = readFixture("manga-paginated.html");
      const page2 = `
        <div class="manga-info-text"><h1>Bleach</h1></div>
        <div class="chapter-list">
          <div class="row">
            <span><a href="https://mangakakalot.gg/chapter/bleach/chapter-685">Chapter 685</a></span>
            <span title="Aug 15, 2016 00:00">Aug 15,2016</span>
          </div>
        </div>`;
      const http = makeHttp({
        "https://mangakakalot.gg/manga/bleach": page1,
        "https://mangakakalot.gg/manga/bleach?page=2": page2,
      });
      const client = createMangakakalotClient({ http, logger: makeLogger() });

      const chapters = await client.getChapterList("bleach");
      expect(chapters.length).toBe(2);
      expect(chapters[0]?.chapter).toBe("686");
      expect(chapters[1]?.chapter).toBe("685");
      // @ts-ignore
      expect(http.get).toHaveBeenCalledTimes(2);
    });

    it("propagates CloudflareError without swallowing", async () => {
      const { CloudflareError } = await import("@integrations/fallback-http/types.ts");
      const http: FallbackHttpClient = {
        get: mock(async () => {
          throw new CloudflareError("https://mangakakalot.gg/manga/naruto");
        }),
      };
      const client = createMangakakalotClient({ http, logger: makeLogger() });
      await expect(client.getChapterList("naruto")).rejects.toBeInstanceOf(CloudflareError);
    });

    it("logs warn and propagates MangakakalotParseError when DOM is broken", async () => {
      const brokenHtml = "<html><body>404 not found</body></html>";
      const url = "https://mangakakalot.gg/manga/test-manga";
      const http = makeHttp({ [url]: brokenHtml });
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
      const http = makeHttp({ "https://mangakakalot.gg/chapter/naruto/chapter-1": html });
      const client = createMangakakalotClient({ http, logger: makeLogger() });

      const images = await client.getChapterImages(
        "https://mangakakalot.gg/chapter/naruto/chapter-1",
      );
      expect(images.length).toBe(3);
    });

    it("accepts a path-style id", async () => {
      const html = readFixture("chapter-naruto-1.html");
      const http = makeHttp({ "https://mangakakalot.gg/chapter/naruto/chapter-1": html });
      const client = createMangakakalotClient({ http, logger: makeLogger() });

      const images = await client.getChapterImages("chapter/naruto/chapter-1");
      expect(images.length).toBe(3);
    });

    it("logs mangakakalot.fetch event", async () => {
      const html = readFixture("chapter-naruto-1.html");
      const http = makeHttp({ "https://mangakakalot.gg/chapter/naruto/chapter-1": html });
      const logger = makeLogger();
      const client = createMangakakalotClient({ http, logger });

      await client.getChapterImages("chapter/naruto/chapter-1");
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
          throw new CloudflareError("https://mangakakalot.gg/chapter/naruto/chapter-1");
        }),
      };
      const client = createMangakakalotClient({ http, logger: makeLogger() });
      await expect(client.getChapterImages("chapter/naruto/chapter-1")).rejects.toBeInstanceOf(
        CloudflareError,
      );
    });

    it("logs warn and propagates MangakakalotParseError when reader has no images", async () => {
      const brokenHtml = "<html><body><div class='container-chapter-reader'></div></body></html>";
      const url = "https://mangakakalot.gg/chapter/naruto/chapter-1";
      const http = makeHttp({ [url]: brokenHtml });
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
