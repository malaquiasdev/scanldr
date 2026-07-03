import { describe, expect, mock, test } from "bun:test";
import type { SourceAdapter } from "../../sources/adapters/index.ts";
import type { ChapterListing, SearchHit, VolumeListing } from "../types.ts";
import { WalkthroughError } from "../types.ts";

const mockHit: SearchHit = {
  id: "mock-1",
  title: "Test Manga",
  originalLanguage: "ja",
  year: 2020,
};

const mockChapters: ChapterListing[] = [
  { id: "mock-1-ch-1", num: "1", label: "Chapter 1" },
  { id: "mock-1-ch-2", num: "2", label: "Chapter 2" },
  { id: "mock-1-ch-3", num: "3", label: "Chapter 3" },
  { id: "mock-1-ch-4", num: "4", label: "Chapter 4" },
  { id: "mock-1-ch-5", num: "5", label: "Chapter 5" },
];

const mockVolumes: VolumeListing[] = [
  { volume: "1", label: "Volume 1", chapterIds: ["mock-1-ch-1"], chapterNums: ["1"] },
  {
    volume: "2",
    label: "Volume 2",
    chapterIds: ["mock-1-ch-2", "mock-1-ch-3"],
    chapterNums: ["2", "3"],
  },
  {
    volume: "3",
    label: "Volume 3",
    chapterIds: ["mock-1-ch-4", "mock-1-ch-5"],
    chapterNums: ["4", "5"],
  },
];

function makeFakeAdapter(chapters: ChapterListing[], volumes: VolumeListing[]): SourceAdapter {
  return {
    search: async () => [],
    listChapters: async () => chapters,
    listVolumes: async () => volumes,
    fetchChapterInput: async () => {
      throw new Error("not implemented");
    },
  };
}

describe("pickRange", () => {
  test("chapter mode: multi-select returns selected bundles array", async () => {
    mock.module("../prompts.ts", () => ({
      checkbox: async () => ["mock-1-ch-1", "mock-1-ch-3"],
      select: async () => "",
      input: async () => "",
      confirm: async () => false,
      editor: async () => "",
    }));
    const adapter = makeFakeAdapter(mockChapters, mockVolumes);
    const { pickRange } = await import("./range-picker.ts");
    const result = await pickRange({ hit: mockHit, mode: "chapter", adapter });
    expect(result.bundles).toHaveLength(2);
    expect(result.bundles.map((b) => b.id)).toContain("mock-1-ch-1");
    expect(result.bundles.map((b) => b.id)).toContain("mock-1-ch-3");
  });

  test("empty selection — throws error", async () => {
    mock.module("../prompts.ts", () => ({
      checkbox: async (opts: {
        validate?: (items: readonly { value: string }[]) => string | boolean;
      }) => {
        const res = opts.validate?.([]);
        if (typeof res === "string") throw new Error(res);
        return [];
      },
      select: async () => "",
      input: async () => "",
      confirm: async () => false,
      editor: async () => "",
    }));
    const adapter = makeFakeAdapter(mockChapters, mockVolumes);
    const { pickRange } = await import("./range-picker.ts");
    await expect(pickRange({ hit: mockHit, mode: "chapter", adapter })).rejects.toThrow(
      /at least one/i,
    );
  });

  test("volume mode returns volume bundles with Volume labels", async () => {
    mock.module("../prompts.ts", () => ({
      checkbox: async () => ["vol:1"],
      select: async () => "",
      input: async () => "",
      confirm: async () => false,
      editor: async () => "",
    }));
    const adapter = makeFakeAdapter(mockChapters, mockVolumes);
    const { pickRange } = await import("./range-picker.ts");
    const result = await pickRange({ hit: mockHit, mode: "volume", adapter });
    expect(result.bundles[0]?.label).toMatch(/Volume/);
  });

  test("chapter mode: throws WalkthroughError when adapter returns empty chapter list", async () => {
    mock.module("../prompts.ts", () => ({
      checkbox: async () => [],
      select: async () => "",
      input: async () => "",
      confirm: async () => false,
      editor: async () => "",
    }));
    const adapter = makeFakeAdapter([], mockVolumes);
    const { pickRange } = await import("./range-picker.ts");
    await expect(pickRange({ hit: mockHit, mode: "chapter", adapter })).rejects.toThrow(
      WalkthroughError,
    );
  });

  test("volume mode: throws WalkthroughError when adapter returns empty volume list", async () => {
    mock.module("../prompts.ts", () => ({
      checkbox: async () => [],
      select: async () => "",
      input: async () => "",
      confirm: async () => false,
      editor: async () => "",
    }));
    const emptyVolumeAdapter: SourceAdapter = {
      search: async () => [],
      listChapters: async () => mockChapters,
      listVolumes: async () => {
        throw new WalkthroughError("no volumes");
      },
      fetchChapterInput: async () => {
        throw new Error("not implemented");
      },
    };
    const { pickRange } = await import("./range-picker.ts");
    await expect(
      pickRange({ hit: mockHit, mode: "volume", adapter: emptyVolumeAdapter }),
    ).rejects.toThrow(WalkthroughError);
  });
});
