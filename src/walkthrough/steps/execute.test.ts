import { describe, expect, mock, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChapterInput } from "../../modules/downloader/types.ts";
import { createLogger } from "../../plugins/logger/index.ts";
import type { SourceAdapter } from "../../sources/adapters/index.ts";
import { getSource } from "../../sources/index.ts";
import type { WalkthroughResult } from "../types.ts";
import type { ExecuteWalkthroughInput } from "./execute.ts";

const source = getSource("mangadex");

const plan: WalkthroughResult = {
  title: "Naruto",
  source,
  hit: { id: "hit-1", title: "Naruto", originalLanguage: "ja", year: 1999 },
  mode: "chapter",
  selectedBundles: [{ label: "Chapter 1", id: "hit-1-ch-1" }],
  groupIntoVolume: false,
  coverUrl: null,
};

const noop = () => {};
const logger = createLogger({ level: "info", format: "human", write: noop });
const outDir = join(tmpdir(), `execute-test-${Date.now()}`);

const fakeChapterInput: ChapterInput = {
  id: "hit-1-ch-1",
  num: 1,
  pages: [{ url: "https://example.com/page1.jpg", page: 1 }],
  imageFetcher: async () => new Uint8Array([0, 1, 2]),
};

function makeFakeAdapter(overrides: Partial<SourceAdapter> = {}): SourceAdapter {
  return {
    search: async () => [],
    listChapters: async () => [],
    listVolumes: async () => [],
    fetchChapterInput: async () => fakeChapterInput,
    ...overrides,
  };
}

describe("executeWalkthrough", () => {
  test("calls adapter.fetchChapterInput for each bundle", async () => {
    const fetchedIds: string[] = [];
    const adapter = makeFakeAdapter({
      fetchChapterInput: async (id) => {
        fetchedIds.push(id);
        return fakeChapterInput;
      },
    });

    // Mock downloadBundle so it doesn't actually write to disk
    mock.module("../../modules/downloader/index.ts", () => ({
      downloadBundle: async () => ({
        chapterIds: ["hit-1-ch-1"],
        outputPath: join(outDir, "naruto", "naruto-chapter-001.cbz"),
        byteSize: 100,
      }),
    }));

    const { executeWalkthrough } = await import("./execute.ts");
    const opts: ExecuteWalkthroughInput = {
      ...plan,
      outDir,
      adapter,
      logger,
    };
    const result = await executeWalkthrough(opts);
    expect(fetchedIds).toContain("hit-1-ch-1");
    expect(result.failed).toBe(0);
  });

  test("failed bundle increments failed count", async () => {
    const failingAdapter = makeFakeAdapter({
      fetchChapterInput: async () => {
        throw new Error("network error");
      },
    });

    mock.module("../../modules/downloader/index.ts", () => ({
      downloadBundle: async () => {
        throw new Error("unreachable");
      },
    }));

    const { executeWalkthrough } = await import("./execute.ts");
    const opts: ExecuteWalkthroughInput = {
      ...plan,
      outDir,
      adapter: failingAdapter,
      logger,
    };
    const result = await executeWalkthrough(opts);
    expect(result.failed).toBe(1);
    expect(result.outputs).toHaveLength(0);
  });

  test("groupIntoVolume=true calls packVolume when no failures", async () => {
    const packCalls: string[] = [];

    mock.module("../../modules/downloader/index.ts", () => ({
      downloadBundle: async () => ({
        chapterIds: ["hit-1-ch-1"],
        outputPath: join(outDir, "naruto", "naruto-chapter-001.cbz"),
        byteSize: 100,
      }),
    }));

    mock.module("../../commands/download/pack.ts", () => ({
      packVolume: async (input: { slug: string }) => {
        packCalls.push(input.slug);
        return { outputPath: join(outDir, "naruto", "naruto-volume-001.cbz"), byteSize: 500 };
      },
      deleteIndividualFiles: async () => {},
      buildVolumeFilename: (slug: string, input: string) => `${slug}-volume-${input}.cbz`,
      defaultVolumeName: (slug: string) => `${slug}-volume`,
    }));

    const { executeWalkthrough } = await import("./execute.ts");
    const opts: ExecuteWalkthroughInput = {
      ...plan,
      groupIntoVolume: true,
      outDir,
      adapter: makeFakeAdapter(),
      logger,
    };
    const result = await executeWalkthrough(opts);
    expect(packCalls).toContain("naruto");
    expect(result.failed).toBe(0);
  });

  test("groupIntoVolume=false does not call packVolume", async () => {
    const packCalls: string[] = [];

    mock.module("../../modules/downloader/index.ts", () => ({
      downloadBundle: async () => ({
        chapterIds: ["hit-1-ch-1"],
        outputPath: join(outDir, "naruto", "naruto-chapter-001.cbz"),
        byteSize: 100,
      }),
    }));

    mock.module("../../commands/download/pack.ts", () => ({
      packVolume: async (input: { slug: string }) => {
        packCalls.push(input.slug);
        return { outputPath: "", byteSize: 0 };
      },
      deleteIndividualFiles: async () => {},
      buildVolumeFilename: (slug: string, input: string) => `${slug}-volume-${input}.cbz`,
      defaultVolumeName: (slug: string) => `${slug}-volume`,
    }));

    const { executeWalkthrough } = await import("./execute.ts");
    const opts: ExecuteWalkthroughInput = {
      ...plan,
      groupIntoVolume: false,
      outDir,
      adapter: makeFakeAdapter(),
      logger,
    };
    await executeWalkthrough(opts);
    expect(packCalls).toHaveLength(0);
  });
});
