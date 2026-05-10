import { describe, expect, test } from "bun:test";
import type { ChapterRef, MangaCandidate, VolumeRef } from "@integrations/_shared/manga.ts";
import type { MangaDexClient } from "@integrations/mangadex/client/index.ts";
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

  test("listChapters maps ChapterRef to ChapterListing with title when present", async () => {
    const adapter = createMangaDexAdapter({ logger, client: makeFakeClient() });
    const chapters = await adapter.listChapters("mdx-naruto");
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({
      id: "ch-uuid-1",
      label: "Chapter 1 — Enter Naruto",
    });
    // Chapter without title should just show number
    expect(chapters[1]).toMatchObject({
      id: "ch-uuid-2",
      label: "Chapter 2",
    });
  });

  test("listVolumes maps VolumeRef to VolumeListing", async () => {
    const adapter = createMangaDexAdapter({ logger, client: makeFakeClient() });
    const volumes = await adapter.listVolumes("mdx-naruto");
    expect(volumes).toHaveLength(2);
    expect(volumes[0]?.label).toMatch(/Volume 1/);
    expect(volumes[0]?.id).toContain("vol:1:");
  });

  test("listVolumes throws WalkthroughError when aggregate returns empty", async () => {
    const adapter = createMangaDexAdapter({
      logger,
      client: makeFakeClient({ aggregateVolumes: async () => [] }),
    });
    await expect(adapter.listVolumes("mdx-naruto")).rejects.toThrow(WalkthroughError);
  });
});
