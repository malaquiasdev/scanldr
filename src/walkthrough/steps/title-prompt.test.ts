import { describe, expect, mock, test } from "bun:test";

describe("promptTitle", () => {
  test("returns user-typed value", async () => {
    mock.module("../prompts.ts", () => ({
      input: async (_opts: unknown) => "One Piece",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { promptTitle } = await import("./title-prompt.ts");
    const result = await promptTitle();
    expect(result).toBe("One Piece");
  });

  test("empty string — validate rejects (returns error string not empty)", async () => {
    // Verify validate function returns an error message for empty input
    mock.module("../prompts.ts", () => ({
      input: async (opts: { validate?: (v: string) => string | boolean }) => {
        const validation = opts.validate?.("");
        if (typeof validation === "string") throw new Error(validation);
        return "valid title";
      },
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { promptTitle } = await import("./title-prompt.ts");
    await expect(promptTitle()).rejects.toThrow(/empty/i);
  });
});
