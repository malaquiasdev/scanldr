import { describe, expect, mock, test } from "bun:test";
import { SOURCES } from "../../sources/registry.ts";

describe("pickSource", () => {
  test("auto-selects the sole source without prompting (single-source short-circuit)", async () => {
    let selectCalled = false;
    mock.module("../prompts.ts", () => ({
      select: async () => {
        selectCalled = true;
        return "mangakakalot";
      },
      input: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { pickSource } = await import("./source-picker.ts");
    const result = await pickSource();

    expect(selectCalled).toBe(false);
    expect(result.id).toBe("mangakakalot");
    expect(result.requiresAuth).toBe(true);
    expect(SOURCES).toHaveLength(1);
  });
});
