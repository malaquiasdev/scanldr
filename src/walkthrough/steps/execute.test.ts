import { describe, expect, mock, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChapterInput } from "@integrations/_shared/media.ts";
import { CloudflareError } from "../../integrations/fallback-http/types.ts";
import { createLogger } from "../../plugins/logger/index.ts";
import type { SourceAdapter } from "../../sources/adapters/index.ts";
import { getSource } from "../../sources/index.ts";
import type { Downloader, Packer, WalkthroughResult } from "../types.ts";
import { WalkthroughError } from "../types.ts";
import type { ExecuteWalkthroughInput } from "./execute.ts";
import { executeWalkthrough } from "./execute.ts";

const source = getSource("mangadex");

const plan: WalkthroughResult = {
  title: "Naruto",
  source,
  hit: { id: "hit-1", title: "Naruto", originalLanguage: "ja", year: 1999 },
  mode: "chapter",
  selectedBundles: [{ kind: "chapter", label: "Chapter 1", id: "hit-1-ch-1", num: "1" }],
  groupIntoVolume: false,
  volumeName: null,
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

  test("CF during page download triggers refresh + retry succeeds", async () => {
    let downloadAttempts = 0;
    const refreshFn = mock(async () => {});
    const adapter = makeFakeAdapter();
    const downloader = makeFakeDownloader({
      downloadBundle: mock(async (_input) => {
        downloadAttempts++;
        if (downloadAttempts === 1) {
          throw new CloudflareError("https://example.com/page1.jpg");
        }
        return {
          chapterIds: ["hit-1-ch-1"],
          outputPath: join(outDir, "naruto", "naruto-chapter-001.cbz"),
          byteSize: 100,
        };
      }),
    });

    const opts: ExecuteWalkthroughInput = { ...plan, outDir, adapter, logger, refreshFn };
    const result = await executeWalkthrough(opts, { downloader, packer: makeFakePacker() });

    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(0);
    expect(result.outputs).toHaveLength(1);
  });

  test("CF survives refresh → walkthrough aborts with WalkthroughError", async () => {
    const refreshFn = mock(async () => {});
    const downloader = makeFakeDownloader({
      downloadBundle: mock(async () => {
        throw new CloudflareError("https://example.com/page1.jpg");
      }),
    });

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      outDir,
      adapter: makeFakeAdapter(),
      logger,
      refreshFn,
    };

    await expect(
      executeWalkthrough(opts, { downloader, packer: makeFakePacker() }),
    ).rejects.toBeInstanceOf(WalkthroughError);
  });

  test("non-CF error → failed incremented, function returns normally", async () => {
    const refreshFn = mock(async () => {});
    const downloader = makeFakeDownloader({
      downloadBundle: mock(async () => {
        throw new Error("disk full");
      }),
    });

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      outDir,
      adapter: makeFakeAdapter(),
      logger,
      refreshFn,
    };
    const result = await executeWalkthrough(opts, { downloader, packer: makeFakePacker() });

    expect(refreshFn).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.outputs).toHaveLength(0);
  });

  test("CF during fetchChapterInput triggers refresh + retry succeeds", async () => {
    let fetchAttempts = 0;
    const refreshFn = mock(async () => {});
    const adapter = makeFakeAdapter({
      fetchChapterInput: async () => {
        fetchAttempts++;
        if (fetchAttempts === 1) {
          throw new CloudflareError("https://example.com/api/chapter");
        }
        return fakeChapterInput;
      },
    });

    const opts: ExecuteWalkthroughInput = { ...plan, outDir, adapter, logger, refreshFn };
    const result = await executeWalkthrough(opts, {
      downloader: makeFakeDownloader(),
      packer: makeFakePacker(),
    });

    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(0);
    expect(result.outputs).toHaveLength(1);
  });

  // P1 #1 — CF on the SECOND bundle of a multi-bundle loop
  test("CF on second bundle: first bundle succeeds without retry, second retries after refresh", async () => {
    const downloadCalls: string[] = [];
    const refreshFn = mock(async () => {});

    const bundle1 = { kind: "chapter" as const, label: "Chapter 1", id: "ch-1", num: "1" };
    const bundle2 = { kind: "chapter" as const, label: "Chapter 2", id: "ch-2", num: "2" };

    let bundle2Attempts = 0;
    const downloader = makeFakeDownloader({
      downloadBundle: mock(async (input) => {
        const bundleNum = (input as { bundleNumber: string }).bundleNumber;
        downloadCalls.push(bundleNum);
        if (bundleNum === "2") {
          bundle2Attempts++;
          if (bundle2Attempts === 1) {
            throw new CloudflareError("https://example.com/page.jpg");
          }
        }
        return {
          chapterIds: [bundleNum === "1" ? "ch-1" : "ch-2"],
          outputPath: join(outDir, "naruto", `naruto-chapter-00${bundleNum}.cbz`),
          byteSize: 100,
        };
      }),
    });

    const fetchCalls: string[] = [];
    const adapter = makeFakeAdapter({
      fetchChapterInput: async (id, num) => {
        fetchCalls.push(id);
        return { ...fakeChapterInput, id, num: Number(num ?? "0") };
      },
    });

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      selectedBundles: [bundle1, bundle2],
      outDir,
      adapter,
      logger,
      refreshFn,
    };

    const result = await executeWalkthrough(opts, { downloader, packer: makeFakePacker() });

    expect(result.outputs).toHaveLength(2);
    expect(result.failed).toBe(0);
    expect(refreshFn).toHaveBeenCalledTimes(1);

    // bundle 1 fetched once, no retry
    expect(fetchCalls.filter((id) => id === "ch-1")).toHaveLength(1);
    // bundle 2 fetched twice: initial attempt + retry after refresh
    expect(fetchCalls.filter((id) => id === "ch-2")).toHaveLength(2);
  });

  // P1 #2 — CF on volume-mode fetchChapterInput inside Promise.all
  test("CF in volume fetchChapterInput: retries whole doBundle, total fetchChapterInput calls = 6", async () => {
    const refreshFn = mock(async () => {});
    let fetchCallCount = 0;

    const adapter = makeFakeAdapter({
      fetchChapterInput: async (id, num) => {
        fetchCallCount++;
        // On the very first call to c2 in the first attempt, throw CF
        // Since Promise.all runs concurrently, we track total calls: first 3 calls = attempt 1
        // Throw on the 2nd call (c2) during first attempt only
        if (fetchCallCount === 2) {
          throw new CloudflareError("https://example.com/api/chapter");
        }
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
      refreshFn,
    };

    const result = await executeWalkthrough(opts, {
      downloader: makeFakeDownloader(),
      packer: makeFakePacker(),
    });

    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(result.outputs).toHaveLength(1);
    expect(result.failed).toBe(0);
    // 3 calls on first attempt (one throws CF) + 3 calls on retry = 6
    expect(fetchCallCount).toBe(6);
  });

  // P2 — pack is skipped when WalkthroughError aborts mid-loop
  test("packVolume NOT called when WalkthroughError aborts execution", async () => {
    const refreshFn = mock(async () => {});
    const downloader = makeFakeDownloader({
      downloadBundle: mock(async () => {
        throw new CloudflareError("https://example.com/page.jpg");
      }),
    });
    const packer = makeFakePacker();

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      groupIntoVolume: true,
      outDir,
      adapter: makeFakeAdapter(),
      logger,
      refreshFn,
    };

    await expect(executeWalkthrough(opts, { downloader, packer })).rejects.toBeInstanceOf(
      WalkthroughError,
    );

    expect((packer.packVolume as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  // P2 — refreshFn undefined + CF falls through to outer catch
  test("refreshFn undefined + CF error: failed incremented, function returns normally", async () => {
    const downloader = makeFakeDownloader({
      downloadBundle: mock(async () => {
        throw new CloudflareError("https://example.com/page.jpg");
      }),
    });

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      outDir,
      adapter: makeFakeAdapter(),
      logger,
      // refreshFn intentionally omitted
    };

    const result = await executeWalkthrough(opts, { downloader, packer: makeFakePacker() });

    expect(result.failed).toBe(1);
    expect(result.outputs).toHaveLength(0);
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
