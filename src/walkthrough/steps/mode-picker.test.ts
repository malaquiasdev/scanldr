import { describe, expect, mock, test } from "bun:test";

describe("pickMode", () => {
  test("returns 'chapter' when selected", async () => {
    mock.module("../prompts.ts", () => ({
      select: async () => "chapter",
      input: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { pickMode } = await import("./mode-picker.ts");
    expect(await pickMode()).toBe("chapter");
  });

  test("returns 'volume' when selected", async () => {
    mock.module("../prompts.ts", () => ({
      select: async () => "volume",
      input: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { pickMode } = await import("./mode-picker.ts");
    expect(await pickMode()).toBe("volume");
  });
});
