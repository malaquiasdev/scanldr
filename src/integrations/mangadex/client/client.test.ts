import { describe, expect, it } from "bun:test";
import { createMangaDexClient } from "./index.ts";
import { normalizeLang, parseAggregate, parseChapterFeed, parseMangaList } from "./parser.ts";
import type {
  MdxAggregateResponse,
  MdxChapterListResponse,
  MdxMangaListResponse,
} from "./types.ts";

import aggregateFixture from "./fixtures/aggregate.json";
import chapterFeedFixture from "./fixtures/chapter-feed.json";
import searchMulti from "./fixtures/manga-search-multi.json";
import searchSingle from "./fixtures/manga-search-single.json";

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
});

describe("createMangaDexClient", () => {
  it("resolveTitleToId throws when no candidates", async () => {
    const http = {
      get: async <T>(_path: string, _q?: unknown) => ({ result: "ok", data: [] }) as unknown as T,
    };
    const client = createMangaDexClient(http);
    await expect(client.resolveTitleToId("nonexistent")).rejects.toThrow("No manga found");
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
});
