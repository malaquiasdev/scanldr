import { describe, expect, mock, test } from "bun:test";
import type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
import type { ImageRef } from "@integrations/_shared/media.ts";
import type { MangakakalotClient, VolumeBucket } from "@integrations/mangakakalot/client/index.ts";
import { createLogger } from "@plugins/logger/index.ts";
import { WalkthroughError } from "../../walkthrough/types.ts";
import { createMangakakalotAdapter } from "./mangakakalot.ts";

const noop = () => {};
const logger = createLogger({ level: "info", format: "human", write: noop });

const candidateFixtures: MangaCandidate[] = [
  { id: "naruto", title: "Naruto", originalLanguage: "ja", year: 1999 },
  { id: "one-piece", title: "One Piece", originalLanguage: "ja", year: 1997 },
];

const chapterFixtures: ChapterRef[] = [
  {
    id: "naruto/chapter-1",
    volume: "1",
    chapter: "1",
    title: "Enter! Naruto Uzumaki!",
    translatedLanguage: "en",
    scanlationGroup: null,
    readableAt: "2020-01-01T00:00:00Z",
    externalUrl: null,
  },
  {
    id: "naruto/chapter-2",
    volume: "1",
    chapter: "2",
    title: "Konohamaru!",
    translatedLanguage: "en",
    scanlationGroup: null,
    readableAt: "2020-01-08T00:00:00Z",
    externalUrl: null,
  },
];

const volumeFixtures: VolumeBucket[] = [
  {
    volume: "1",
    chapters: [
      { id: "naruto/chapter-1", chapter: "1" },
      { id: "naruto/chapter-2", chapter: "2" },
    ],
  },
  {
    volume: "2",
    chapters: [{ id: "naruto/chapter-3", chapter: "3" }],
  },
];

function makeFakeClient(overrides: Partial<MangakakalotClient> = {}): MangakakalotClient {
  return {
    searchManga: async () => candidateFixtures,
    getChapterList: async () => chapterFixtures,
    getVolumeMap: async () => volumeFixtures,
    getChapterImages: async (): Promise<ImageRef[]> => [
      { url: "https://cdn.mangakakalot.gg/naruto/chapter-1/page-01.jpg", page: 1 },
    ],
    ...overrides,
  };
}

describe("MangakakalotAdapter", () => {
  test("search maps MangaCandidate to SearchHit", async () => {
    const adapter = createMangakakalotAdapter({ logger, client: makeFakeClient() });
    const hits = await adapter.search("naruto");
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      id: "naruto",
      title: "Naruto",
      originalLanguage: "ja",
      year: 1999,
    });
  });

  test("search returns empty array when client returns empty", async () => {
    const adapter = createMangakakalotAdapter({
      logger,
      client: makeFakeClient({ searchManga: async () => [] }),
    });
    const hits = await adapter.search("unknown");
    expect(hits).toHaveLength(0);
  });

  test("listChapters maps ChapterRef to ChapterListing with num from source", async () => {
    const adapter = createMangakakalotAdapter({ logger, client: makeFakeClient() });
    const chapters = await adapter.listChapters("naruto");
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({ id: "naruto/chapter-1", num: "1", label: "Chapter 1" });
    expect(chapters[1]).toMatchObject({ id: "naruto/chapter-2", num: "2", label: "Chapter 2" });
  });

  test("listVolumes maps VolumeBucket to VolumeListing with chapterIds and chapterNums", async () => {
    const adapter = createMangakakalotAdapter({ logger, client: makeFakeClient() });
    const volumes = await adapter.listVolumes("naruto");
    expect(volumes).toHaveLength(2);
    expect(volumes[0]?.label).toMatch(/Volume 1/);
    expect(volumes[0]?.volume).toBe("1");
    // chapterIds populated in source order
    expect(volumes[0]?.chapterIds).toEqual(["naruto/chapter-1", "naruto/chapter-2"]);
    // chapterNums parallel to chapterIds
    expect(volumes[0]?.chapterNums).toEqual(["1", "2"]);
    expect(volumes[0]?.chapterIds?.length).toBe(volumes[0]?.chapterNums?.length);
    // second volume
    expect(volumes[1]?.chapterIds).toEqual(["naruto/chapter-3"]);
    expect(volumes[1]?.chapterNums).toEqual(["3"]);
  });

  test("listVolumes throws WalkthroughError when volume map is empty", async () => {
    const adapter = createMangakakalotAdapter({
      logger,
      client: makeFakeClient({ getVolumeMap: async () => [] }),
    });
    await expect(adapter.listVolumes("naruto")).rejects.toThrow(WalkthroughError);
  });

  test("listChapters maps chapter:null to the 'none' sentinel, not a synthetic sequential number", async () => {
    const chapterFixturesWithNull: ChapterRef[] = [
      {
        id: "naruto/chapter-1",
        volume: "1",
        chapter: "1",
        title: "Enter! Naruto Uzumaki!",
        translatedLanguage: "en",
        scanlationGroup: null,
        readableAt: "2020-01-01T00:00:00Z",
        externalUrl: null,
      },
      {
        id: "naruto/extra-1",
        volume: "1",
        chapter: null,
        title: "Special Omake",
        translatedLanguage: "en",
        scanlationGroup: null,
        readableAt: "2020-01-02T00:00:00Z",
        externalUrl: null,
      },
    ];
    const adapter = createMangakakalotAdapter({
      logger,
      client: makeFakeClient({ getChapterList: async () => chapterFixturesWithNull }),
    });
    const chapters = await adapter.listChapters("naruto");
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({ id: "naruto/chapter-1", num: "1" });
    expect(chapters[1]).toMatchObject({
      id: "naruto/extra-1",
      num: "none-1",
      label: "Chapter none",
    });
    // Must never derive a synthetic sequential/misleading chapter number from the
    // array index (old bug: "2") — the "none-N" suffix is a disambiguator, not a
    // chapter number, and stays non-numeric (never matches /^\d+$/).
    expect(chapters[1]?.num).not.toBe("2");
    expect(chapters[1]?.num).toMatch(/^none-\d+$/);
  });

  test("listChapters disambiguates multiple null chapters so standalone/chapter-mode downloads never collide on filename", async () => {
    const chapterFixturesWithMultipleNulls: ChapterRef[] = [
      {
        id: "naruto/extra-1",
        volume: "1",
        chapter: null,
        title: "Special Omake 1",
        translatedLanguage: "en",
        scanlationGroup: null,
        readableAt: "2020-01-01T00:00:00Z",
        externalUrl: null,
      },
      {
        id: "naruto/extra-2",
        volume: "1",
        chapter: null,
        title: "Special Omake 2",
        translatedLanguage: "en",
        scanlationGroup: null,
        readableAt: "2020-01-02T00:00:00Z",
        externalUrl: null,
      },
    ];
    const adapter = createMangakakalotAdapter({
      logger,
      client: makeFakeClient({ getChapterList: async () => chapterFixturesWithMultipleNulls }),
    });
    const chapters = await adapter.listChapters("naruto");
    expect(chapters).toHaveLength(2);

    // Each chapter's `num` is what execute.ts turns into `bundleNumber` for
    // standalone/chapter-mode downloads (via `bundle.num.replace(...)`), which
    // becomes the output filename `${slug}-chapter-${padded}.cbz`. Distinct nums
    // here means distinct filenames on disk — no silent overwrite.
    expect(chapters[0]?.num).not.toBe(chapters[1]?.num);
    expect(chapters[0]?.num).toMatch(/^none-\d+$/);
    expect(chapters[1]?.num).toMatch(/^none-\d+$/);

    // Simulate execute.ts's sanitization + padBundleNumber pipeline to prove
    // the resulting filenames are distinct.
    const sanitized = chapters.map((c) => c.num.replace(/[^a-z0-9.]/gi, "-"));
    expect(new Set(sanitized).size).toBe(2);
  });

  test("listVolumes maps chapter:null to the 'none' sentinel, not a bucketIndex-based number", async () => {
    const volumeFixturesWithNull: VolumeBucket[] = [
      {
        volume: "1",
        chapters: [
          { id: "naruto/chapter-1", chapter: "1" },
          { id: "naruto/extra-1", chapter: null },
        ],
      },
    ];
    const adapter = createMangakakalotAdapter({
      logger,
      client: makeFakeClient({ getVolumeMap: async () => volumeFixturesWithNull }),
    });
    const volumes = await adapter.listVolumes("naruto");
    expect(volumes).toHaveLength(1);
    expect(volumes[0]?.chapterNums).toEqual(["1", "none-1"]);
    // Must never produce the old synthetic bucketIndex*1000 + i + 1 shape (e.g. "1002").
    expect(volumes[0]?.chapterNums?.some((n) => /^\d{4}$/.test(n))).toBe(false);
  });

  test("fetchChapterInput resolves pages from getChapterImages", async () => {
    const imageRefs: ImageRef[] = [
      { url: "https://cdn.mangakakalot.gg/naruto/ch1/p01.jpg", page: 1 },
      { url: "https://cdn.mangakakalot.gg/naruto/ch1/p02.jpg", page: 2 },
    ];
    const fakeImageBytes = new Uint8Array([0xff, 0xd8, 0xff]); // JPEG magic bytes

    const getMock = mock(async (_url: string) => {
      throw new Error("http.get must NOT be called for image CDN URLs — use getAnonymous");
    });
    const getAnonymousMock = mock(async () => new Response(fakeImageBytes.buffer as ArrayBuffer));

    const adapter = createMangakakalotAdapter({
      logger,
      client: makeFakeClient({ getChapterImages: async () => imageRefs }),
      http: {
        get: getMock as unknown as (
          url: string,
          headers?: Record<string, string>,
        ) => Promise<Response>,
        getAnonymous: getAnonymousMock as unknown as (
          url: string,
          headers?: Record<string, string>,
        ) => Promise<Response>,
      },
    });
    const input = await adapter.fetchChapterInput("naruto/chapter-1");
    expect(input.id).toBe("naruto/chapter-1");
    expect(input.pages).toHaveLength(2);

    // Exercise imageFetcher so CDN routing is verified
    const [firstPage, secondPage] = input.pages;
    if (!firstPage || !secondPage) throw new Error("test setup expected ≥2 pages");
    await input.imageFetcher(firstPage);
    await input.imageFetcher(secondPage);
    expect(getAnonymousMock).toHaveBeenCalledTimes(2);
  });

  test("imageFetcher calls getAnonymous, not get (cookie isolation regression guard)", async () => {
    const CDN_URL = "https://cdn.mangakakalot.gg/naruto/ch1/p01.jpg";
    const imageRefs: ImageRef[] = [{ url: CDN_URL, page: 1 }];
    const fakeImageBytes = new Uint8Array([0xff, 0xd8, 0xff]);

    const getMock = mock(async (_url: string) => {
      throw new Error("http.get must NOT be called for image CDN URLs — use getAnonymous");
    });
    const getAnonymousMock = mock(async () => new Response(fakeImageBytes.buffer as ArrayBuffer));

    const adapter = createMangakakalotAdapter({
      logger,
      client: makeFakeClient({ getChapterImages: async () => imageRefs }),
      http: {
        get: getMock as unknown as (
          url: string,
          headers?: Record<string, string>,
        ) => Promise<Response>,
        getAnonymous: getAnonymousMock as unknown as (
          url: string,
          headers?: Record<string, string>,
        ) => Promise<Response>,
      },
    });

    const input = await adapter.fetchChapterInput("naruto/chapter-1");
    // Invoke imageFetcher — this is where the CDN routing happens
    const [onlyPage] = input.pages;
    if (!onlyPage) throw new Error("test setup expected ≥1 page");
    await input.imageFetcher(onlyPage);

    // getAnonymous must have been called with the CDN URL
    expect(getAnonymousMock).toHaveBeenCalled();
    const calls = getAnonymousMock.mock.calls as unknown as [string, Record<string, string>?][];
    const [firstCall] = calls;
    if (!firstCall) throw new Error("test setup expected ≥1 call");
    expect(firstCall[0]).toBe(CDN_URL);
    // referer header must be present so CDN hotlink protection allows the request
    expect(firstCall[1]?.referer).toBe("https://www.mangakakalot.gg/");

    // get must NOT have been called with the CDN URL (cookie leakage prevention)
    const getCalls = getMock.mock.calls as unknown as [string, Record<string, string>?][];
    const getCalledWithCdn = getCalls.some((c) => c[0] === CDN_URL);
    expect(getCalledWithCdn).toBe(false);
  });
});
