import { describe, expect, mock, test } from "bun:test";

describe("promptPack", () => {
  test("returns true when user confirms", async () => {
    mock.module("../prompts.ts", () => ({
      confirm: async () => true,
      select: async () => "",
      input: async () => "",
      checkbox: async () => [],
      editor: async () => "",
    }));
    const { promptPack } = await import("./pack-prompt.ts");
    expect(await promptPack()).toBe(true);
  });

  test("returns false when user declines", async () => {
    mock.module("../prompts.ts", () => ({
      confirm: async () => false,
      select: async () => "",
      input: async () => "",
      checkbox: async () => [],
      editor: async () => "",
    }));
    const { promptPack } = await import("./pack-prompt.ts");
    expect(await promptPack()).toBe(false);
  });
});
