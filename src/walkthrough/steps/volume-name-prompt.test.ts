import { describe, expect, mock, test } from "bun:test";
import { createLogger } from "../../plugins/logger/index.ts";

const logger = createLogger({ level: "info", format: "human", write: () => {} });

describe("promptVolumeName", () => {
  test("empty input returns null (keeps auto-generated name)", async () => {
    mock.module("../prompts.ts", () => ({
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { promptVolumeName } = await import("./volume-name-prompt.ts");
    expect(await promptVolumeName({ logger })).toBeNull();
  });

  test("whitespace-only input returns null", async () => {
    mock.module("../prompts.ts", () => ({
      input: async () => "   ",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { promptVolumeName } = await import("./volume-name-prompt.ts");
    expect(await promptVolumeName({ logger })).toBeNull();
  });

  test("plain number returns the trimmed string", async () => {
    mock.module("../prompts.ts", () => ({
      input: async () => "  1  ",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { promptVolumeName } = await import("./volume-name-prompt.ts");
    expect(await promptVolumeName({ logger })).toBe("1");
  });

  test("descriptive name with spaces is accepted", async () => {
    mock.module("../prompts.ts", () => ({
      input: async () => "special edition",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { promptVolumeName } = await import("./volume-name-prompt.ts");
    expect(await promptVolumeName({ logger })).toBe("special edition");
  });

  test("path separator rejected twice then returns null", async () => {
    let calls = 0;
    const warnEvents: string[] = [];
    const warnLogger = createLogger({ level: "info", format: "human", write: () => {} });
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
        return "../escape";
      },
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));
    const { promptVolumeName } = await import("./volume-name-prompt.ts");
    const result = await promptVolumeName({ logger: warnLogger });
    expect(result).toBeNull();
    expect(calls).toBe(2);
    expect(warnEvents).toContain("walkthrough.volume_name_invalid");
  });
});
