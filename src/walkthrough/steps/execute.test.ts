import { describe, expect, mock, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChapterInput } from "../../modules/downloader/types.ts";
import { createLogger } from "../../plugins/logger/index.ts";
import type { SourceAdapter } from "../../sources/adapters/index.ts";
import { getSource } from "../../sources/index.ts";
import type { Downloader, Packer, WalkthroughResult } from "../types.ts";
import { executeWalkthrough } from "./execute.ts";
import type { ExecuteWalkthroughInput } from "./execute.ts";

const source = getSource("mangadex");

const plan: WalkthroughResult = {
  title: "Naruto",
  source,
  hit: { id: "hit-1", title: "Naruto", originalLanguage: "ja", year: 1999 },
  mode: "chapter",
  selectedBundles: [{ kind: "chapter", label: "Chapter 1", id: "hit-1-ch-1", num: "1" }],
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

function makeFakeDownloader(overrides: Partial<Downloader> = {}): Downloader {
  return {
    downloadBundle: mock(async () => ({
      chapterIds: ["hit-1-ch-1"],
      outputPath: join(outDir, "naruto", "naruto-chapter-001.cbz"),
      byteSize: 100,
    })),
    ...overrides,
  };
}

function makeFakePacker(overrides: Partial<Packer> = {}): Packer {
  return {
    packVolume: mock(async (input) => ({
      outputPath: join(outDir, "naruto", `${input.slug}-volume-001.cbz`),
      byteSize: 500,
    })),
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

    const opts: ExecuteWalkthroughInput = { ...plan, outDir, adapter, logger };
    const result = await executeWalkthrough(opts, {
      downloader: makeFakeDownloader(),
      packer: makeFakePacker(),
    });

    expect(fetchedIds).toContain("hit-1-ch-1");
    expect(result.failed).toBe(0);
  });

  test("failed bundle increments failed count", async () => {
    const failingAdapter = makeFakeAdapter({
      fetchChapterInput: async () => {
        throw new Error("network error");
      },
    });

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      outDir,
      adapter: failingAdapter,
      logger,
    };
    const result = await executeWalkthrough(opts, {
      downloader: makeFakeDownloader(),
      packer: makeFakePacker(),
    });

    expect(result.failed).toBe(1);
    expect(result.outputs).toHaveLength(0);
  });

  test("groupIntoVolume=true calls packVolume when no failures", async () => {
    const packCalls: string[] = [];

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      groupIntoVolume: true,
      outDir,
      adapter: makeFakeAdapter(),
      logger,
    };
    const result = await executeWalkthrough(opts, {
      downloader: makeFakeDownloader(),
      packer: makeFakePacker({
        packVolume: mock(async (input) => {
          packCalls.push(input.slug);
          return { outputPath: join(outDir, "naruto", "naruto-volume-001.cbz"), byteSize: 500 };
        }),
      }),
    });

    expect(packCalls).toContain("naruto");
    expect(result.failed).toBe(0);
  });

  test("groupIntoVolume=false does not call packVolume", async () => {
    const packCalls: string[] = [];

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      groupIntoVolume: false,
      outDir,
      adapter: makeFakeAdapter(),
      logger,
    };
    await executeWalkthrough(opts, {
      downloader: makeFakeDownloader(),
      packer: makeFakePacker({
        packVolume: mock(async (input) => {
          packCalls.push(input.slug);
          return { outputPath: "", byteSize: 0 };
        }),
      }),
    });

    expect(packCalls).toHaveLength(0);
  });

  test("volume mode: fetchChapterInput called once per chapter id, downloader called once with all inputs", async () => {
    const fetchedIds: string[] = [];
    const adapter = makeFakeAdapter({
      fetchChapterInput: async (id, num) => {
        fetchedIds.push(id);
        return { ...fakeChapterInput, id, num: Number(num ?? "0") };
      },
    });

    const volumeBundle = {
      kind: "volume" as const,
      label: "Volume 1",
      id: "vol:1",
      num: "1",
      chapterIds: ["c1", "c2", "c3"],
      chapterNums: ["1", "2", "3"],
    };

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      mode: "volume",
      selectedBundles: [volumeBundle],
      groupIntoVolume: true,
      outDir,
      adapter,
      logger,
    };

    const fakeDownloader = makeFakeDownloader();
    const result = await executeWalkthrough(opts, {
      downloader: fakeDownloader,
      packer: makeFakePacker(),
    });

    expect(fetchedIds).toEqual(["c1", "c2", "c3"]);
    expect(result.failed).toBe(0);
    // downloader called once with all 3 chapter inputs
    expect((fakeDownloader.downloadBundle as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    const rawCall = (fakeDownloader.downloadBundle as ReturnType<typeof mock>).mock
      .calls[0] as unknown[];
    const downloadArg = rawCall[0] as { chapters: unknown[] };
    expect(downloadArg.chapters).toHaveLength(3);
  });

  test("volume mode → packer.packVolume is NOT called", async () => {
    const packer = makeFakePacker();
    const volumeBundle = {
      kind: "volume" as const,
      label: "Volume 1",
      id: "vol:1",
      num: "1",
      chapterIds: ["c1", "c2"],
      chapterNums: ["1", "2"],
    };

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      mode: "volume",
      selectedBundles: [volumeBundle],
      groupIntoVolume: true,
      coverUrl: null,
      outDir,
      adapter: makeFakeAdapter(),
      logger,
    };

    const result = await executeWalkthrough(opts, {
      downloader: makeFakeDownloader(),
      packer,
    });

    expect((packer.packVolume as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    // downloader-produced path is the final artifact
    expect(result.outputs).toHaveLength(1);
    expect(result.failed).toBe(0);
  });

  test("volume mode with coverUrl → cover-skipped warn emitted", async () => {
    const warnEvents: string[] = [];
    const capturingLogger = createLogger({
      level: "warn",
      format: "human",
      write: noop,
    });
    // Override warn to capture events; msg is always provided by executeWalkthrough
    const origWarn = capturingLogger.warn.bind(capturingLogger);
    capturingLogger.warn = (obj: Record<string, unknown>, msg: string) => {
      if (typeof obj === "object" && obj !== null && "event" in obj) {
        warnEvents.push(obj.event as string);
      }
      return origWarn(obj, msg);
    };

    const volumeBundle = {
      kind: "volume" as const,
      label: "Volume 1",
      id: "vol:1",
      num: "1",
      chapterIds: ["c1"],
      chapterNums: ["1"],
    };

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      mode: "volume",
      selectedBundles: [volumeBundle],
      groupIntoVolume: true,
      coverUrl: "https://example.com/cover.jpg",
      outDir,
      adapter: makeFakeAdapter(),
      logger: capturingLogger,
    };

    await executeWalkthrough(opts, {
      downloader: makeFakeDownloader(),
      packer: makeFakePacker(),
    });

    expect(warnEvents).toContain("walkthrough.cover_skipped_volume_mode");
  });

  test("pack filename uses bundle.num (numeric), not bundle.id (opaque)", async () => {
    const capturedChapters: Array<{ num: string }> = [];
    const opts: ExecuteWalkthroughInput = {
      ...plan,
      selectedBundles: [
        { kind: "chapter", label: "Chapter 103.5", id: "naruto/chapter-103.5", num: "103.5" },
      ],
      groupIntoVolume: true,
      outDir,
      adapter: makeFakeAdapter(),
      logger,
    };

    await executeWalkthrough(opts, {
      downloader: makeFakeDownloader(),
      packer: makeFakePacker({
        packVolume: mock(async (input) => {
          capturedChapters.push(...input.chapters);
          return { outputPath: join(outDir, "out.cbz"), byteSize: 1 };
        }),
      }),
    });

    expect(capturedChapters[0]?.num).toBe("103.5");
    expect(capturedChapters[0]?.num).not.toContain("/");
  });
});
