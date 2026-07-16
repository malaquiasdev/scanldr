import { describe, expect, mock, test } from "bun:test";
import type { SourceAdapter } from "../../sources/adapters/index.ts";
import type { ChapterListing, SearchHit } from "../types.ts";
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

function makeFakeAdapter(chapters: ChapterListing[]): SourceAdapter {
  return {
    search: async () => [],
    listChapters: async () => chapters,
    fetchChapterInput: async () => {
      throw new Error("not implemented");
    },
  };
}

describe("pickRange", () => {
  test("multi-select returns selected bundles array", async () => {
    mock.module("../prompts.ts", () => ({
      checkbox: async () => ["mock-1-ch-1", "mock-1-ch-3"],
      select: async () => "",
      input: async () => "",
      confirm: async () => false,
      editor: async () => "",
    }));
    const adapter = makeFakeAdapter(mockChapters);
    const { pickRange } = await import("./range-picker.ts");
    const result = await pickRange({ hit: mockHit, adapter });
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
    const adapter = makeFakeAdapter(mockChapters);
    const { pickRange } = await import("./range-picker.ts");
    await expect(pickRange({ hit: mockHit, adapter })).rejects.toThrow(/at least one/i);
  });

  test("throws WalkthroughError when adapter returns empty chapter list", async () => {
    mock.module("../prompts.ts", () => ({
      checkbox: async () => [],
      select: async () => "",
      input: async () => "",
      confirm: async () => false,
      editor: async () => "",
    }));
    const adapter = makeFakeAdapter([]);
    const { pickRange } = await import("./range-picker.ts");
    await expect(pickRange({ hit: mockHit, adapter })).rejects.toThrow(WalkthroughError);
  });
});
