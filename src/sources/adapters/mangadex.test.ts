import { describe, expect, test } from "bun:test";
import type { ChapterRef, MangaCandidate, VolumeRef } from "@integrations/_shared/manga.ts";
import type { MangaDexClient } from "@integrations/mangadex/client/index.ts";
import { createMangaDexClient } from "@integrations/mangadex/client/index.ts";
import type { MangaDexHttpClient } from "@integrations/mangadex/http/index.ts";
import { createLogger } from "@plugins/logger/index.ts";
import { WalkthroughError } from "../../walkthrough/types.ts";
import { createMangaDexAdapter } from "./mangadex.ts";

const noop = () => {};
const logger = createLogger({ level: "info", format: "human", write: noop });

const candidateFixtures: MangaCandidate[] = [
  { id: "mdx-naruto", title: "Naruto", originalLanguage: "ja", year: 1999 },
  { id: "mdx-bleach", title: "Bleach", originalLanguage: "ja", year: 2001 },
];

const chapterFixtures: ChapterRef[] = [
  {
    id: "ch-uuid-1",
    volume: "1",
    chapter: "1",
    title: "Enter Naruto",
    translatedLanguage: "en",
    scanlationGroup: "Group A",
    readableAt: "2020-01-01T00:00:00Z",
    externalUrl: null,
  },
  {
    id: "ch-uuid-2",
    volume: "1",
    chapter: "2",
    title: null,
    translatedLanguage: "en",
    scanlationGroup: null,
    readableAt: "2020-01-08T00:00:00Z",
    externalUrl: null,
  },
];

const volumeFixtures: VolumeRef[] = [
  { volume: "1", numeric: 1, chapterIds: ["ch-uuid-1", "ch-uuid-2"] },
  { volume: "2", numeric: 2, chapterIds: ["ch-uuid-3"] },
];

function makeFakeClient(overrides: Partial<MangaDexClient> = {}): MangaDexClient {
  return {
    searchManga: async () => candidateFixtures,
    aggregateVolumes: async () => volumeFixtures,
    feedChapters: async () => chapterFixtures,
    resolveTitleToId: async () => candidateFixtures,
    ...overrides,
  };
}

describe("MangaDexAdapter", () => {
  test("search maps MangaCandidate to SearchHit", async () => {
    const adapter = createMangaDexAdapter({ logger, client: makeFakeClient() });
    const hits = await adapter.search("naruto");
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      id: "mdx-naruto",
      title: "Naruto",
      originalLanguage: "ja",
      year: 1999,
    });
  });

  test("search returns empty array when client returns empty", async () => {
    const adapter = createMangaDexAdapter({
      logger,
      client: makeFakeClient({ searchManga: async () => [] }),
    });
    const hits = await adapter.search("unknown");
    expect(hits).toHaveLength(0);
  });

  test("listChapters maps ChapterRef to ChapterListing with num and title when present", async () => {
    const adapter = createMangaDexAdapter({ logger, client: makeFakeClient() });
    const chapters = await adapter.listChapters("mdx-naruto");
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({
      id: "ch-uuid-1",
      num: "1",
      label: "Chapter 1 — Enter Naruto",
    });
    // Chapter without title should just show number
    expect(chapters[1]).toMatchObject({
      id: "ch-uuid-2",
      num: "2",
      label: "Chapter 2",
    });
  });

  test("listVolumes maps VolumeRef to VolumeListing with chapterIds and chapterNums", async () => {
    const adapter = createMangaDexAdapter({ logger, client: makeFakeClient() });
    const volumes = await adapter.listVolumes("mdx-naruto");
    expect(volumes).toHaveLength(2);
    expect(volumes[0]?.label).toMatch(/Volume 1/);
    expect(volumes[0]?.volume).toBe("1");
    // chapterIds from aggregate
    expect(volumes[0]?.chapterIds).toEqual(["ch-uuid-1", "ch-uuid-2"]);
    // chapterNums from feedChapters lookup
    expect(volumes[0]?.chapterNums).toEqual(["1", "2"]);
    expect(volumes[0]?.chapterIds?.length).toBe(volumes[0]?.chapterNums?.length);
  });

  test("listVolumes throws WalkthroughError when aggregate returns empty", async () => {
    const adapter = createMangaDexAdapter({
      logger,
      client: makeFakeClient({ aggregateVolumes: async () => [] }),
    });
    await expect(adapter.listVolumes("mdx-naruto")).rejects.toThrow(WalkthroughError);
  });

  test("listVolumes resolves chapter numbers beyond offset 500 (end-to-end pagination benefit)", async () => {
    // Full multi-page series driven through the real client via injected http —
    // proves feedChapters' pagination fix flows all the way through the adapter's
    // chapterNumById lookup map, not just at the client layer.
    const TOTAL = 1100;
    const LIMIT = 500;

    function makeChapterData(n: number) {
      return {
        id: `ch-${n}`,
        type: "chapter" as const,
        attributes: {
          volume: "1",
          chapter: String(n),
          title: null,
          translatedLanguage: "en",
          readableAt: "2021-01-01T00:00:00+00:00",
          externalUrl: null,
        },
        relationships: [],
      };
    }

    const http: MangaDexHttpClient = {
      get: async <T>(path: string, query?: unknown) => {
        const q = query as Record<string, unknown>;
        if (path.endsWith("/aggregate")) {
          return {
            result: "ok",
            volumes: {
              "1": {
                volume: "1",
                count: TOTAL,
                chapters: Object.fromEntries(
                  Array.from({ length: TOTAL }, (_, i) => i + 1).map((n) => [
                    String(n),
                    { chapter: String(n), id: `ch-${n}`, others: [], count: 1 },
                  ]),
                ),
              },
            },
          } as unknown as T;
        }
        // /manga/:id/feed
        const offset = Number(q.offset ?? 0);
        const data = Array.from({ length: Math.min(LIMIT, Math.max(0, TOTAL - offset)) }, (_, i) =>
          makeChapterData(offset + i + 1),
        );
        return {
          result: "ok",
          data,
          limit: LIMIT,
          offset,
          total: TOTAL,
        } as unknown as T;
      },
    };

    const client = createMangaDexClient(http, logger);
    const adapter = createMangaDexAdapter({ logger, client });
    const volumes = await adapter.listVolumes("mdx-naruto");

    expect(volumes).toHaveLength(1);
    const vol1 = volumes[0];
    // Chapter 900 lives beyond the old 500-cap; its number must resolve, not fall back to the id.
    const idx900 = vol1?.chapterIds.indexOf("ch-900");
    expect(idx900).toBeGreaterThanOrEqual(0);
    expect(vol1?.chapterNums[idx900 as number]).toBe("900");
    // And the very last chapter also resolves.
    const idxLast = vol1?.chapterIds.indexOf(`ch-${TOTAL}`);
    expect(idxLast).toBeGreaterThanOrEqual(0);
    expect(vol1?.chapterNums[idxLast as number]).toBe(String(TOTAL));
  });
});
