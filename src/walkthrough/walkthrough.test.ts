import { describe, expect, mock, test } from "bun:test";
import { createLogger } from "../plugins/logger/index.ts";
import type { SourceAdapter } from "../sources/adapters/index.ts";
import type { ChapterListing, SearchHit, VolumeListing } from "./types.ts";

const noop = () => {};
const logger = createLogger({ level: "info", format: "human", write: noop });

const fakeHits: SearchHit[] = [
  { id: "mock-1", title: "Naruto", originalLanguage: "ja", year: 1999 },
];

const fakeChapters: ChapterListing[] = [
  { id: "mock-1-ch-1", label: "Chapter 1" },
  { id: "mock-1-ch-2", label: "Chapter 2" },
];

const fakeVolumes: VolumeListing[] = [{ id: "mock-1-vol-1", label: "Volume 1" }];

function makeFakeAdapter(overrides: Partial<SourceAdapter> = {}): SourceAdapter {
  return {
    search: async () => fakeHits,
    listChapters: async () => fakeChapters,
    listVolumes: async () => fakeVolumes,
    fetchChapterInput: async () => {
      throw new Error("not needed in walkthrough tests");
    },
    ...overrides,
  };
}

const fakeAdapterFactory = (_sourceId: string, _opts: unknown): SourceAdapter => makeFakeAdapter();

describe("runWalkthrough — full happy path", () => {
  test("mode=chapter + group=true + cover URL → returns assembled plan", async () => {
    let inputCall = 0;
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => {
        inputCall++;
        if (inputCall === 1) return "Naruto"; // title
        return "https://example.com/cover.jpg"; // cover URL
      },
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex"; // source
        if (selectCall === 2) return "mock-1"; // search result
        return "chapter"; // mode
      },
      checkbox: async () => ["mock-1-ch-1", "mock-1-ch-2"],
      confirm: async () => true,
      editor: async () => "",
    }));

    selectCall = 0;
    inputCall = 0;
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      titlePrefill: "Naruto",
      adapterFactory: fakeAdapterFactory,
    });
    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
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
        if (selectCall === 1) return "mangadex"; // source
        if (selectCall === 2) return "mock-1"; // search result
        return "volume"; // mode
      },
      checkbox: async () => ["mock-1-vol-1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    selectCall = 0;
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      titlePrefill: "One Piece",
      adapterFactory: fakeAdapterFactory,
    });
    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.mode).toBe("volume");
    expect(result.groupIntoVolume).toBe(true);
  });

  test("mode=chapter + group=false → cover-prompt skipped, coverUrl is null", async () => {
    let inputCallCount = 0;
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => {
        inputCallCount++;
        return opts.default ?? "Bleach";
      },
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        if (selectCall === 2) return "mock-1";
        return "chapter";
      },
      checkbox: async () => ["mock-1-ch-1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    const inputCallsBefore = inputCallCount;
    selectCall = 0;
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      titlePrefill: "Bleach",
      adapterFactory: fakeAdapterFactory,
    });
    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);

    expect(result.coverUrl).toBeNull();
    expect(result.groupIntoVolume).toBe(false);
    expect(inputCallCount - inputCallsBefore).toBe(1); // only title step called input
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
    const result = await runWalkthrough({ logger, adapterFactory: fakeAdapterFactory });
    expect(result).toEqual({ cancelled: true });
  });

  test("empty search results → returns { ok: false, reason: WalkthroughError message }", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => opts.default ?? "Unknown Manga",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        return "chapter";
      },
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));

    selectCall = 0;
    const emptyAdapter = makeFakeAdapter({ search: async () => [] });
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      titlePrefill: "Unknown Manga",
      adapterFactory: () => emptyAdapter,
    });
    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    expect("ok" in result && result.ok === false).toBe(true);
    if ("ok" in result) {
      expect(result.reason).toMatch(/No results found/);
    }
  });
});
