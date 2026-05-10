import { describe, expect, mock, test } from "bun:test";
import { createLogger } from "../plugins/logger/index.ts";

const noop = () => {};
const logger = createLogger({ level: "info", format: "human", write: noop });

describe("runWalkthrough — full happy path", () => {
  test("mode=chapter + group=true + cover URL → returns assembled plan", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => {
        // title step
        return opts.default ?? "Naruto";
      },
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex"; // source — no auth needed
        if (selectCall === 2) return "mock-1"; // search result
        return "chapter"; // mode
      },
      checkbox: async () => ["mock-1-ch-1", "mock-1-ch-2"],
      confirm: async () => true, // groupIntoVolume
      editor: async () => "",
    }));

    // cover URL — second input call
    let inputCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => {
        inputCall++;
        if (inputCall === 1) return "Naruto"; // title
        return "https://example.com/cover.jpg"; // cover URL
      },
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        if (selectCall === 2) return "mock-1";
        return "chapter";
      },
      checkbox: async () => ["mock-1-ch-1", "mock-1-ch-2"],
      confirm: async () => true,
      editor: async () => "",
    }));

    selectCall = 0;
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({ logger, titlePrefill: "Naruto" });
    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    expect(result.mode).toBe("chapter");
    expect(result.groupIntoVolume).toBe(true);
    expect(result.coverUrl).toBe("https://example.com/cover.jpg");
    expect(result.selectedBundles).toHaveLength(2);
  });

  test("mode=volume (auto-pack) → returns assembled plan with groupIntoVolume=true", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => opts.default ?? "One Piece",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        if (selectCall === 2) return "mock-1";
        return "volume";
      },
      checkbox: async () => ["mock-1-vol-1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    selectCall = 0;
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({ logger, titlePrefill: "One Piece" });
    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    expect(result.mode).toBe("volume");
    expect(result.groupIntoVolume).toBe(true); // auto-set for volume mode
  });

  test("Ctrl+C (ExitPromptError) returns { cancelled: true }", async () => {
    const ExitPromptError = class extends Error {
      override name = "ExitPromptError";
    };

    mock.module("./prompts.ts", () => ({
      input: async () => {
        throw new ExitPromptError("User force closed the prompt");
      },
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));

    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({ logger });
    expect(result).toEqual({ cancelled: true });
  });
});
