import { describe, expect, mock, test } from "bun:test";
import type { SearchHit } from "../types.ts";

const mockHit: SearchHit = {
  id: "mock-1",
  title: "Test Manga",
  originalLanguage: "ja",
  year: 2020,
};

describe("pickRange", () => {
  test("multi-select returns selected bundles array", async () => {
    mock.module("../prompts.ts", () => ({
      checkbox: async () => ["mock-1-ch-1", "mock-1-ch-3"],
      select: async () => "",
      input: async () => "",
      confirm: async () => false,
      editor: async () => "",
    }));
    const { pickRange } = await import("./range-picker.ts");
    const result = await pickRange({ hit: mockHit, mode: "chapter" });
    expect(result).toHaveLength(2);
    expect(result.map((b) => b.id)).toContain("mock-1-ch-1");
    expect(result.map((b) => b.id)).toContain("mock-1-ch-3");
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
    const { pickRange } = await import("./range-picker.ts");
    await expect(pickRange({ hit: mockHit, mode: "chapter" })).rejects.toThrow(/at least one/i);
  });

  test("volume mode returns volume bundles", async () => {
    mock.module("../prompts.ts", () => ({
      checkbox: async () => ["mock-1-vol-1"],
      select: async () => "",
      input: async () => "",
      confirm: async () => false,
      editor: async () => "",
    }));
    const { pickRange } = await import("./range-picker.ts");
    const result = await pickRange({ hit: mockHit, mode: "volume" });
    expect(result[0]?.label).toMatch(/Volume/);
  });
});
