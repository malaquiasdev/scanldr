import { describe, expect, mock, test } from "bun:test";

describe("promptCoverUrl", () => {
  test("empty input returns null", async () => {
    mock.module("../prompts.ts", () => ({
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { promptCoverUrl } = await import("./cover-prompt.ts");
    expect(await promptCoverUrl()).toBeNull();
  });

  test("valid URL returns the URL string", async () => {
    mock.module("../prompts.ts", () => ({
      input: async () => "https://example.com/cover.jpg",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { promptCoverUrl } = await import("./cover-prompt.ts");
    expect(await promptCoverUrl()).toBe("https://example.com/cover.jpg");
  });

  test("invalid URL twice then returns null (graceful skip after max retries)", async () => {
    let calls = 0;
    mock.module("../prompts.ts", () => ({
      input: async () => {
        calls++;
        return "not-a-valid-url";
      },
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { promptCoverUrl } = await import("./cover-prompt.ts");
    const result = await promptCoverUrl();
    expect(result).toBeNull();
    expect(calls).toBe(2);
  });
});
