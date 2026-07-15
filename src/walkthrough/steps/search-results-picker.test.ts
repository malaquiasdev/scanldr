import { describe, expect, mock, test } from "bun:test";
import type { SourceAdapter } from "../../sources/adapters/index.ts";
import type { SearchHit } from "../types.ts";

const results: SearchHit[] = [
  { id: "hit-1", title: "Manga A", originalLanguage: "ja", year: 2020 },
  { id: "hit-2", title: "Manga B", originalLanguage: "ja", year: 2021 },
  { id: "hit-3", title: "Manga C", originalLanguage: "ja", year: 2022 },
];

function makeFakeAdapter(hits: SearchHit[]): SourceAdapter {
  return {
    search: async () => hits,
    listChapters: async () => [],
    fetchChapterInput: async () => {
      throw new Error("not implemented");
    },
  };
}

describe("pickSearchResult", () => {
  test("happy path: select returns id of hit #2, result matches hit #2 by reference", async () => {
    mock.module("../prompts.ts", () => ({
      select: async () => "hit-2",
      input: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));

    const adapter = makeFakeAdapter(results);
    const { pickSearchResult } = await import("./search-results-picker.ts");
    const result = await pickSearchResult({ query: "Manga", sourceLabel: "Test", adapter });
    const expected = results[1];
    if (!expected) throw new Error("fixture has no index 1");
    expect(result).toBe(expected);
  });

  test("throws when select returns unknown id", async () => {
    mock.module("../prompts.ts", () => ({
      select: async () => "hit-999",
      input: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));

    const adapter = makeFakeAdapter(results);
    const { pickSearchResult } = await import("./search-results-picker.ts");
    await expect(
      pickSearchResult({ query: "Manga", sourceLabel: "Test", adapter }),
    ).rejects.toThrow(/Unknown|Unexpected/);
  });

  test("throws WalkthroughError when adapter returns empty results", async () => {
    mock.module("../prompts.ts", () => ({
      select: async () => "",
      input: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));

    const adapter = makeFakeAdapter([]);
    const { pickSearchResult } = await import("./search-results-picker.ts");
    await expect(
      pickSearchResult({ query: "Missing Title", sourceLabel: "TestSource", adapter }),
    ).rejects.toThrow(/No results found for "Missing Title" on TestSource/);
  });
});
