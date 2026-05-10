import { describe, expect, mock, test } from "bun:test";
import { createLogger } from "../../plugins/logger/index.ts";

const logger = createLogger({ level: "info", format: "human", write: () => {} });

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
    expect(await promptCoverUrl({ logger })).toBeNull();
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
    expect(await promptCoverUrl({ logger })).toBe("https://example.com/cover.jpg");
  });

  test("invalid URL twice then returns null (graceful skip after max retries)", async () => {
    let calls = 0;
    const warnEvents: string[] = [];
    const warnLogger = createLogger({
      level: "info",
      format: "human",
      write: () => {},
    });
    // Patch warn to capture events
    const origWarn = warnLogger.warn.bind(warnLogger);
    (warnLogger as { warn: typeof warnLogger.warn }).warn = (
      fields: Record<string, unknown>,
      msg: string,
    ) => {
      if (typeof fields.event === "string") warnEvents.push(fields.event);
      origWarn(fields, msg);
    };

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
    const result = await promptCoverUrl({ logger: warnLogger });
    expect(result).toBeNull();
    expect(calls).toBe(2);
    expect(warnEvents).toContain("walkthrough.cover_invalid_url");
  });
});
