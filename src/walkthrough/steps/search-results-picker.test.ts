import { describe, expect, mock, test } from "bun:test";
import type { SearchHit } from "../types.ts";

const results: SearchHit[] = [
  { id: "hit-1", title: "Manga A", originalLanguage: "ja", year: 2020 },
  { id: "hit-2", title: "Manga B", originalLanguage: "ja", year: 2021 },
  { id: "hit-3", title: "Manga C", originalLanguage: "ja", year: 2022 },
];

describe("pickSearchResult", () => {
  test("happy path: select returns id of hit #2, result matches hit #2 by reference", async () => {
    mock.module("../prompts.ts", () => ({
      select: async () => "hit-2",
      input: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));

    // Override mocked search results via mocks module
    mock.module("../mocks.ts", () => ({
      getMockedSearchResults: () => results,
      getMockedBundles: () => [],
    }));

    const { pickSearchResult } = await import("./search-results-picker.ts");
    const result = await pickSearchResult({ query: "Manga", sourceId: "mangadex" });
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

    mock.module("../mocks.ts", () => ({
      getMockedSearchResults: () => results,
      getMockedBundles: () => [],
    }));

    const { pickSearchResult } = await import("./search-results-picker.ts");
    await expect(pickSearchResult({ query: "Manga", sourceId: "mangadex" })).rejects.toThrow(
      /Unknown|Unexpected/,
    );
  });
});
