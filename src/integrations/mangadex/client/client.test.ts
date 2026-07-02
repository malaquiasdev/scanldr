import { describe, expect, it } from "bun:test";
import { createMangaDexClient, TitleNotFoundError } from "./index.ts";
import aggregateFixture from "./mocks/aggregate.json";
import chapterFeedFixture from "./mocks/chapter-feed.json";
import searchMulti from "./mocks/manga-search-multi.json";
import searchSingle from "./mocks/manga-search-single.json";
import { normalizeLang, parseAggregate, parseChapterFeed, parseMangaList } from "./parser.ts";
import type {
  MdxAggregateResponse,
  MdxChapterData,
  MdxChapterListResponse,
  MdxMangaListResponse,
} from "./types.ts";

describe("normalizeLang", () => {
  it("uppercases region subtag", () => {
    expect(normalizeLang("pt-br")).toBe("pt-BR");
    expect(normalizeLang("zh-hk")).toBe("zh-HK");
  });

  it("leaves single-segment langs unchanged", () => {
    expect(normalizeLang("en")).toBe("en");
    expect(normalizeLang("ja")).toBe("ja");
  });
});

describe("parseMangaList", () => {
  it("single result: maps id, title, originalLanguage and year", () => {
    const candidates = parseMangaList(searchSingle as MdxMangaListResponse);
    expect(candidates).toHaveLength(1);
    const [c] = candidates;
    expect(c?.id).toBe("a1c7c817-4e59-43b7-9365-09675a149a6f");
    expect(c?.title).toBe("Berserk");
    expect(c?.originalLanguage).toBe("ja");
    expect(c?.year).toBe(1989);
  });

  it("multi result: returns all candidates", () => {
    const candidates = parseMangaList(searchMulti as MdxMangaListResponse);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.title).toBe("One Piece");
    expect(candidates[1]?.title).toBe("One Piece: Romance Dawn");
  });
});

describe("parseAggregate", () => {
  it("sorts volumes numerically with none last", () => {
    const volumes = parseAggregate(aggregateFixture as MdxAggregateResponse);
    expect(volumes.map((v) => v.volume)).toEqual(["1", "2", "none"]);
  });

  it("none volume has NaN numeric", () => {
    const volumes = parseAggregate(aggregateFixture as MdxAggregateResponse);
    const none = volumes.find((v) => v.volume === "none");
    expect(none).toBeDefined();
    expect(Number.isNaN(none?.numeric)).toBe(true);
  });

  it("collects chapterIds including others array", () => {
    const volumes = parseAggregate(aggregateFixture as MdxAggregateResponse);
    const vol1 = volumes.find((v) => v.volume === "1");
    expect(vol1?.chapterIds).toContain("ch-001");
    expect(vol1?.chapterIds).toContain("ch-002");
    expect(vol1?.chapterIds).toContain("ch-002b"); // from others
    expect(vol1?.chapterIds).toContain("ch-003");
  });
});

describe("parseChapterFeed", () => {
  it("maps scanlation group from relationships", () => {
    const chapters = parseChapterFeed(chapterFeedFixture as MdxChapterListResponse);
    expect(chapters[0]?.scanlationGroup).toBe("Scans R Us");
  });

  it("null scanlationGroup when relationship absent", () => {
    const chapters = parseChapterFeed(chapterFeedFixture as MdxChapterListResponse);
    expect(chapters[1]?.scanlationGroup).toBeNull();
  });

  it("normalizes BCP 47 language on chapters", () => {
    const chapters = parseChapterFeed(chapterFeedFixture as MdxChapterListResponse);
    expect(chapters[1]?.translatedLanguage).toBe("pt-BR");
  });

  it("preserves null volume and chapter for no-volume chapters", () => {
    const chapters = parseChapterFeed(chapterFeedFixture as MdxChapterListResponse);
    expect(chapters[1]?.volume).toBeNull();
    expect(chapters[1]?.chapter).toBeNull();
  });

  it("populates externalUrl as null for CDN-hosted chapters", () => {
    const chapters = parseChapterFeed(chapterFeedFixture as MdxChapterListResponse);
    expect(chapters[0]?.externalUrl).toBeNull();
  });

  it("populates externalUrl with the URL for partner-hosted chapters", () => {
    const chapters = parseChapterFeed(chapterFeedFixture as MdxChapterListResponse);
    expect(chapters[2]?.externalUrl).toBe("https://mangaplus.shueisha.co.jp/viewer/1010633");
  });
});

describe("createMangaDexClient", () => {
  it("resolveTitleToId throws when no candidates", async () => {
    const http = {
      get: async <T>(_path: string, _q?: unknown) => ({ result: "ok", data: [] }) as unknown as T,
    };
    const client = createMangaDexClient(http);
    await expect(client.resolveTitleToId("nonexistent")).rejects.toBeInstanceOf(TitleNotFoundError);
  });

  it("resolveTitleToId returns candidates when found", async () => {
    const http = {
      get: async <T>(_path: string, _q?: unknown) => searchSingle as unknown as T,
    };
    const client = createMangaDexClient(http);
    const results = await client.resolveTitleToId("Berserk");
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("a1c7c817-4e59-43b7-9365-09675a149a6f");
  });

  it("feedChapters passes scanlation_group include", async () => {
    const calls: Array<{ path: string; query: unknown }> = [];
    const http = {
      get: async <T>(path: string, query?: unknown) => {
        calls.push({ path, query });
        return chapterFeedFixture as unknown as T;
      },
    };
    const client = createMangaDexClient(http);
    await client.feedChapters("manga-id", ["en"]);
    expect(calls[0]?.query).toMatchObject({ "includes[]": "scanlation_group" });
  });

  function makeChapter(n: number): MdxChapterData {
    return {
      id: `ch-${n}`,
      type: "chapter",
      attributes: {
        volume: null,
        chapter: String(n),
        title: null,
        translatedLanguage: "en",
        readableAt: "2021-01-01T00:00:00+00:00",
        externalUrl: null,
      },
      relationships: [],
    };
  }

  it("feedChapters paginates until total chapters are fetched (>1000 chapters, 3+ pages)", async () => {
    const TOTAL = 1100;
    const LIMIT = 500;
    const calls: Array<{ path: string; query: Record<string, unknown> }> = [];
    const http = {
      get: async <T>(path: string, query?: unknown) => {
        const q = query as Record<string, unknown>;
        calls.push({ path, query: q });
        const offset = Number(q.offset ?? 0);
        const pageIds = Array.from(
          { length: Math.min(LIMIT, Math.max(0, TOTAL - offset)) },
          (_, i) => offset + i + 1,
        );
        const data = pageIds.map((n) => makeChapter(n));
        return {
          result: "ok",
          response: "collection",
          data,
          limit: LIMIT,
          offset,
          total: TOTAL,
        } as unknown as T;
      },
    };
    const client = createMangaDexClient(http);
    const chapters = await client.feedChapters("manga-id", ["en"]);

    expect(chapters).toHaveLength(TOTAL);
    expect(calls).toHaveLength(3); // 500 + 500 + 100
    expect(chapters.find((c) => c.id === "ch-1")).toBeDefined();
    expect(chapters.find((c) => c.id === "ch-1100")).toBeDefined();
    // A chapter beyond the old 500-cap must resolve — proves the NaN fallback bug is fixed.
    const beyondCutoff = chapters.find((c) => c.id === "ch-900");
    expect(beyondCutoff).toBeDefined();
    expect(Number.isNaN(Number(beyondCutoff?.chapter))).toBe(false);
  });

  it("feedChapters stops exactly at the currentOffset >= total boundary (total is an exact multiple of 500)", async () => {
    const TOTAL = 1000;
    const LIMIT = 500;
    const calls: Array<{ path: string; query: Record<string, unknown> }> = [];
    const http = {
      get: async <T>(path: string, query?: unknown) => {
        const q = query as Record<string, unknown>;
        calls.push({ path, query: q });
        const offset = Number(q.offset ?? 0);
        const pageIds = Array.from(
          { length: Math.min(LIMIT, Math.max(0, TOTAL - offset)) },
          (_, i) => offset + i + 1,
        );
        const data = pageIds.map((n) => makeChapter(n));
        return {
          result: "ok",
          response: "collection",
          data,
          limit: LIMIT,
          offset,
          total: TOTAL,
        } as unknown as T;
      },
    };
    const client = createMangaDexClient(http);
    const chapters = await client.feedChapters("manga-id", ["en"]);

    // Must not make a 3rd, wasteful, empty-page request.
    expect(calls).toHaveLength(2);
    expect(chapters).toHaveLength(TOTAL);
    const ids = chapters.map((c) => c.id);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(chapters.find((c) => c.id === "ch-1")).toBeDefined();
    expect(chapters.find((c) => c.id === "ch-1000")).toBeDefined();
  });

  it("feedChapters makes exactly 1 call and returns empty list for an empty series (total=0)", async () => {
    const calls: Array<{ query: Record<string, unknown> }> = [];
    const warnCalls: Array<{ fields: Record<string, unknown>; msg: string }> = [];
    const logger = {
      info: () => {},
      warn: (fields: Record<string, unknown>, msg: string) => warnCalls.push({ fields, msg }),
      error: () => {},
    };
    const http = {
      get: async <T>(_path: string, query?: unknown) => {
        calls.push({ query: query as Record<string, unknown> });
        return {
          result: "ok",
          response: "collection",
          data: [],
          limit: 500,
          offset: 0,
          total: 0,
        } as unknown as T;
      },
    };
    const client = createMangaDexClient(http, logger);
    const chapters = await client.feedChapters("manga-id", ["en"]);

    expect(calls).toHaveLength(1);
    expect(chapters).toHaveLength(0);
    expect(warnCalls).toHaveLength(0);
  });

  it("feedChapters makes exactly 1 call for a small series (<500 chapters), with correct offset/limit", async () => {
    const TOTAL = 42;
    const calls: Array<{ query: Record<string, unknown> }> = [];
    const http = {
      get: async <T>(_path: string, query?: unknown) => {
        calls.push({ query: query as Record<string, unknown> });
        const data = Array.from({ length: TOTAL }, (_, i) => makeChapter(i + 1));
        return {
          result: "ok",
          response: "collection",
          data,
          limit: 500,
          offset: 0,
          total: TOTAL,
        } as unknown as T;
      },
    };
    const client = createMangaDexClient(http);
    const chapters = await client.feedChapters("manga-id", ["en"]);

    expect(calls).toHaveLength(1);
    expect(chapters).toHaveLength(TOTAL);
    expect(calls[0]?.query).toMatchObject({ offset: 0, limit: 500 });
  });

  it("feedChapters preserves translatedLanguage[] filter across pages", async () => {
    const TOTAL = 600;
    const LIMIT = 500;
    const calls: Array<{ query: Record<string, unknown> }> = [];
    const http = {
      get: async <T>(_path: string, query?: unknown) => {
        const q = query as Record<string, unknown>;
        calls.push({ query: q });
        const offset = Number(q.offset ?? 0);
        const pageIds = Array.from(
          { length: Math.min(LIMIT, Math.max(0, TOTAL - offset)) },
          (_, i) => offset + i + 1,
        );
        const data = pageIds.map((n) => makeChapter(n));
        return {
          result: "ok",
          response: "collection",
          data,
          limit: LIMIT,
          offset,
          total: TOTAL,
        } as unknown as T;
      },
    };
    const client = createMangaDexClient(http);
    await client.feedChapters("manga-id", ["en", "pt-br"]);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.query).toMatchObject({ "translatedLanguage[]": ["en", "pt-br"] });
    expect(calls[1]?.query).toMatchObject({ "translatedLanguage[]": ["en", "pt-br"] });
  });

  it("feedChapters stops at MAX_FEED_PAGES when total never satisfies the stop condition (runaway guard)", async () => {
    const LIMIT = 500;
    let callCount = 0;
    const warnCalls: Array<{ fields: Record<string, unknown>; msg: string }> = [];
    const logger = {
      info: () => {},
      warn: (fields: Record<string, unknown>, msg: string) => warnCalls.push({ fields, msg }),
      error: () => {},
    };
    const http = {
      get: async <T>(_path: string, query?: unknown) => {
        callCount++;
        const q = query as Record<string, unknown>;
        const offset = Number(q.offset ?? 0);
        // Malformed API: total is always far larger than what we've fetched — never satisfied.
        const data = Array.from({ length: LIMIT }, (_, i) => makeChapter(offset + i + 1));
        return {
          result: "ok",
          response: "collection",
          data,
          limit: LIMIT,
          offset,
          total: Number.MAX_SAFE_INTEGER,
        } as unknown as T;
      },
    };
    const client = createMangaDexClient(http, logger);
    const chapters = await client.feedChapters("manga-id", ["en"]);

    expect(callCount).toBe(20); // MAX_FEED_PAGES cap
    expect(chapters).toHaveLength(20 * LIMIT);
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]?.fields).toMatchObject({ event: "mangadex.feed_pagination_capped" });
  });

  it("feedChapters does not warn when total lands exactly on the MAX_FEED_PAGES boundary (complete feed)", async () => {
    const LIMIT = 500;
    const MAX_FEED_PAGES = 20;
    const TOTAL = MAX_FEED_PAGES * LIMIT; // 10000 — completes exactly on the last allowed page.
    let callCount = 0;
    const warnCalls: Array<{ fields: Record<string, unknown>; msg: string }> = [];
    const logger = {
      info: () => {},
      warn: (fields: Record<string, unknown>, msg: string) => warnCalls.push({ fields, msg }),
      error: () => {},
    };
    const http = {
      get: async <T>(_path: string, query?: unknown) => {
        callCount++;
        const q = query as Record<string, unknown>;
        const offset = Number(q.offset ?? 0);
        const pageIds = Array.from(
          { length: Math.min(LIMIT, Math.max(0, TOTAL - offset)) },
          (_, i) => offset + i + 1,
        );
        const data = pageIds.map((n) => makeChapter(n));
        return {
          result: "ok",
          response: "collection",
          data,
          limit: LIMIT,
          offset,
          total: TOTAL,
        } as unknown as T;
      },
    };
    const client = createMangaDexClient(http, logger);
    const chapters = await client.feedChapters("manga-id", ["en"]);

    expect(callCount).toBe(MAX_FEED_PAGES);
    expect(chapters).toHaveLength(TOTAL);
    expect(warnCalls).toHaveLength(0);
  });
});
