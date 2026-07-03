import { describe, expect, test } from "bun:test";

describe("promptNextAction", () => {
  test("returns 'same-manga' when selected", async () => {
    const { mock } = await import("bun:test");
    mock.module("../prompts.ts", () => ({
      select: async () => "same-manga",
      input: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { promptNextAction } = await import("./next-action-prompt.ts");
    expect(await promptNextAction()).toBe("same-manga");
  });

  test("returns 'new-manga' when selected", async () => {
    const { mock } = await import("bun:test");
    mock.module("../prompts.ts", () => ({
      select: async () => "new-manga",
      input: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { promptNextAction } = await import("./next-action-prompt.ts");
    expect(await promptNextAction()).toBe("new-manga");
  });

  test("returns 'quit' when selected", async () => {
    const { mock } = await import("bun:test");
    mock.module("../prompts.ts", () => ({
      select: async () => "quit",
      input: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { promptNextAction } = await import("./next-action-prompt.ts");
    expect(await promptNextAction()).toBe("quit");
  });
});
