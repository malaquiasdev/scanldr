import { describe, expect, mock, test } from "bun:test";
import { SOURCES } from "../../sources/registry.ts";

describe("pickSource", () => {
  test("returns the chosen source descriptor", async () => {
    mock.module("../prompts.ts", () => ({
      select: async () => "mangadex",
      input: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { pickSource } = await import("./source-picker.ts");
    const result = await pickSource();
    const expected = SOURCES.find((s) => s.id === "mangadex");
    if (!expected) throw new Error("mangadex not found in SOURCES");
    expect(result).toEqual(expected);
  });

  test("returns mangakakalot descriptor", async () => {
    mock.module("../prompts.ts", () => ({
      select: async () => "mangakakalot",
      input: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { pickSource } = await import("./source-picker.ts");
    const result = await pickSource();
    expect(result.id).toBe("mangakakalot");
    expect(result.requiresAuth).toBe(true);
  });
});
