import { describe, expect, mock, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChapterInput } from "@integrations/_shared/media.ts";
import { CloudflareError } from "../../integrations/fallback-http/types.ts";
import { MangakakalotParseError } from "../../integrations/mangakakalot/client/types.ts";
import { createLogger } from "../../plugins/logger/index.ts";
import type { SourceAdapter } from "../../sources/adapters/index.ts";
import { getSource } from "../../sources/index.ts";
import type { Downloader, Packer, ProgressHandle, WalkthroughResult } from "../types.ts";
import { WalkthroughError } from "../types.ts";
import type { ExecuteWalkthroughInput } from "./execute.ts";

const mockInjectCoverIntoCbz = mock(async () => {});
const mockFetchCover = mock(async (url: string) => {
  if (url.includes("fail")) throw new Error("fetch failed");
  return { bytes: new Uint8Array([1, 2, 3]), ext: ".jpg" };
});

mock.module("../../pack/index.ts", () => ({
  buildVolumeFilename: (slug: string, name: string) => `${slug}-volume-${name}.cbz`,
  fetchCover: mockFetchCover,
  injectCoverIntoCbz: mockInjectCoverIntoCbz,
  packVolume: mock(async () => ({ outputPath: "path", byteSize: 0 })),
}));

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

  test("volume mode with coverUrl → injects cover and logs success", async () => {
    mockInjectCoverIntoCbz.mockClear();
    mockFetchCover.mockClear();
    mockFetchCover.mockImplementation(async () => ({ bytes: new Uint8Array([1, 2]), ext: ".jpg" }));
    mockInjectCoverIntoCbz.mockImplementation(async () => {});

    const infoEvents: string[] = [];
    const capturingLogger = createLogger({ level: "info", format: "human", write: noop });
    const origInfo = capturingLogger.info.bind(capturingLogger);
    capturingLogger.info = (obj: Record<string, unknown>, msg: string) => {
      if (typeof obj === "object" && obj !== null && "event" in obj) {
        infoEvents.push(obj.event as string);
      }
      return origInfo(obj, msg);
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

    expect(mockFetchCover).toHaveBeenCalledWith("https://example.com/cover.jpg");
    expect(mockInjectCoverIntoCbz).toHaveBeenCalled();
    expect(infoEvents).toContain("walkthrough.cover_injected");
  });

  test("volume mode with coverUrl → cover fetch fails, warns and continues", async () => {
    mockInjectCoverIntoCbz.mockClear();
    mockFetchCover.mockClear();
    mockFetchCover.mockImplementation(async () => {
      throw new Error("fetch failed");
    });

    const warnEvents: string[] = [];
    const capturingLogger = createLogger({ level: "warn", format: "human", write: noop });
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

    expect(mockFetchCover).toHaveBeenCalledWith("https://example.com/cover.jpg");
    expect(mockInjectCoverIntoCbz).not.toHaveBeenCalled();
    expect(warnEvents).toContain("walkthrough.cover_fetch_failed");
  });

  test("volume mode with coverUrl → cover injection fails, warns and continues", async () => {
    mockInjectCoverIntoCbz.mockClear();
    mockFetchCover.mockClear();
    mockFetchCover.mockImplementation(async () => ({ bytes: new Uint8Array([1, 2]), ext: ".jpg" }));
    mockInjectCoverIntoCbz.mockImplementation(async () => {
      throw new Error("injection failed");
    });

    const warnEvents: string[] = [];
    const capturingLogger = createLogger({ level: "warn", format: "human", write: noop });
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

    expect(mockFetchCover).toHaveBeenCalledWith("https://example.com/cover.jpg");
    expect(mockInjectCoverIntoCbz).toHaveBeenCalled();
    expect(warnEvents).toContain("walkthrough.cover_injection_failed");
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

  test("MangakakalotParseError thrown from fetchChapterInput propagates, aborts walkthrough", async () => {
    const adapter = makeFakeAdapter({
      fetchChapterInput: async () => {
        throw new MangakakalotParseError("div.chapter-list", "https://example.com", "DOM drift");
      },
    });

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      outDir,
      adapter,
      logger,
    };

    await expect(
      executeWalkthrough(opts, { downloader: makeFakeDownloader(), packer: makeFakePacker() }),
    ).rejects.toBeInstanceOf(MangakakalotParseError);
  });

  test("MangakakalotParseError thrown from downloader propagates, aborts walkthrough", async () => {
    const downloader = makeFakeDownloader({
      downloadBundle: mock(async () => {
        throw new MangakakalotParseError(
          "img.chapter-image",
          "https://example.com",
          "image src parse failed",
        );
      }),
    });

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      outDir,
      adapter: makeFakeAdapter(),
      logger,
    };

    await expect(
      executeWalkthrough(opts, { downloader, packer: makeFakePacker() }),
    ).rejects.toBeInstanceOf(MangakakalotParseError);
  });

  test("generic Error during download is still swallowed (not MangakakalotParseError)", async () => {
    const adapter = makeFakeAdapter({
      fetchChapterInput: async () => {
        throw new Error("network timeout");
      },
    });

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      outDir,
      adapter,
      logger,
    };

    const result = await executeWalkthrough(opts, {
      downloader: makeFakeDownloader(),
      packer: makeFakePacker(),
    });

    // generic error is swallowed, not rethrown
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

  test("volume mode with coverUrl === null → no cover operations run", async () => {
    mockInjectCoverIntoCbz.mockClear();
    mockFetchCover.mockClear();

    const infoEvents: string[] = [];
    const warnEvents: string[] = [];
    const capturingLogger = createLogger({ level: "info", format: "human", write: noop });
    const origInfo = capturingLogger.info.bind(capturingLogger);
    const origWarn = capturingLogger.warn.bind(capturingLogger);
    capturingLogger.info = (obj: Record<string, unknown>, msg: string) => {
      if (typeof obj === "object" && obj !== null && "event" in obj) {
        infoEvents.push(obj.event as string);
      }
      return origInfo(obj, msg);
    };
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
      coverUrl: null,
      outDir,
      adapter: makeFakeAdapter(),
      logger: capturingLogger,
    };

    const result = await executeWalkthrough(opts, {
      downloader: makeFakeDownloader(),
      packer: makeFakePacker(),
    });

    expect(mockFetchCover).not.toHaveBeenCalled();
    expect(mockInjectCoverIntoCbz).not.toHaveBeenCalled();
    expect(infoEvents.some((e) => e.includes("cover_injected"))).toBe(false);
    expect(warnEvents.some((e) => e.includes("cover_fetch_failed"))).toBe(false);
    expect(result.failed).toBe(0);
    expect(result.outputs).toHaveLength(1);
  });

  test("volume mode with multiple volume bundles → injects cover into each output path", async () => {
    mockInjectCoverIntoCbz.mockClear();
    mockFetchCover.mockClear();
    mockFetchCover.mockImplementation(async () => ({ bytes: new Uint8Array([1, 2]), ext: ".jpg" }));
    mockInjectCoverIntoCbz.mockImplementation(async () => {});

    const volumeBundles = [
      {
        kind: "volume" as const,
        label: "Volume 1",
        id: "vol:1",
        num: "1",
        chapterIds: ["c1"],
        chapterNums: ["1"],
      },
      {
        kind: "volume" as const,
        label: "Volume 2",
        id: "vol:2",
        num: "2",
        chapterIds: ["c2"],
        chapterNums: ["2"],
      },
    ];

    const fakeDownloader = {
      downloadBundle: mock(async (input) => {
        const bundleNum = (input as { bundleNumber: string }).bundleNumber;
        return {
          chapterIds: bundleNum === "1" ? ["c1"] : ["c2"],
          outputPath: join(outDir, "naruto", `naruto-volume-${bundleNum}.cbz`),
          byteSize: 100,
        };
      }),
    };

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      mode: "volume",
      selectedBundles: volumeBundles,
      groupIntoVolume: true,
      coverUrl: "https://example.com/cover.jpg",
      outDir,
      adapter: makeFakeAdapter(),
      logger,
    };

    const result = await executeWalkthrough(opts, {
      downloader: fakeDownloader,
      packer: makeFakePacker(),
    });

    expect(mockFetchCover).toHaveBeenCalledTimes(1);
    expect(mockFetchCover).toHaveBeenCalledWith("https://example.com/cover.jpg");

    expect((mockInjectCoverIntoCbz as ReturnType<typeof mock>).mock.calls).toHaveLength(2);
    const call0 = (mockInjectCoverIntoCbz as ReturnType<typeof mock>).mock.calls[0] as unknown[];
    const path0 = call0[0] as string;
    const cover0 = call0[1] as { bytes: Uint8Array; ext: string };
    expect(path0).toBe(join(outDir, "naruto", "naruto-volume-1.cbz"));
    expect(cover0).toEqual({ bytes: new Uint8Array([1, 2]), ext: ".jpg" });

    const call1 = (mockInjectCoverIntoCbz as ReturnType<typeof mock>).mock.calls[1] as unknown[];
    const path1 = call1[0] as string;
    const cover1 = call1[1] as { bytes: Uint8Array; ext: string };
    expect(path1).toBe(join(outDir, "naruto", "naruto-volume-2.cbz"));
    expect(cover1).toEqual({ bytes: new Uint8Array([1, 2]), ext: ".jpg" });

    expect(result.failed).toBe(0);
    expect(result.outputs).toEqual([
      join(outDir, "naruto", "naruto-volume-1.cbz"),
      join(outDir, "naruto", "naruto-volume-2.cbz"),
    ]);
  });

  test("progress handle is driven end-to-end: updateChapter/updatePage/finish are called from a fake downloader, ending at 100%", async () => {
    const events: string[] = [];
    let completions = 0;
    const fakeProgress: ProgressHandle = {
      updateChapter: (chapterIndex, chapterTotalPages) => {
        completions = 0;
        events.push(`chapter:${chapterIndex}:${chapterTotalPages}`);
      },
      updatePage: () => {
        completions += 1;
        events.push(`page:${completions}`);
      },
      finish: () => {
        events.push("finish");
      },
    };

    // Fake downloader that fires onPageProgress OUT of dispatch order (highest index first),
    // simulating real concurrent fetches where completion order != dispatch order.
    const fakeDownloader: Downloader = {
      downloadBundle: async (input) => {
        const totalPages = input.chapters.reduce((sum, c) => sum + c.pages.length, 0);
        for (let i = totalPages; i >= 1; i--) {
          input.onPageProgress?.(totalPages);
        }
        return {
          chapterIds: input.chapters.map((c) => c.id),
          outputPath: join(outDir, "naruto", "naruto-chapter-001.cbz"),
          byteSize: 100,
        };
      },
    };

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      outDir,
      adapter: makeFakeAdapter(),
      logger,
      progress: fakeProgress,
    };

    const result = await executeWalkthrough(opts, {
      downloader: fakeDownloader,
      packer: makeFakePacker(),
    });

    expect(result.failed).toBe(0);
    expect(events[0]).toBe("chapter:1:1");
    // Completion count for this single-page chapter reaches 1/1 -> the "100%" invariant.
    expect(events).toContain("page:1");
    expect(events[events.length - 1]).toBe("finish");
  });

  // #171 — per-page fetch log vs stderr progress bar clobber
  describe("walkthrough.fetch_page log gating (#171)", () => {
    function makeCapturingLogger() {
      const infoEvents: Array<{ event?: string; msg: string; fields: Record<string, unknown> }> =
        [];
      const capturingLogger = createLogger({ level: "info", format: "human", write: noop });
      const origInfo = capturingLogger.info.bind(capturingLogger);
      capturingLogger.info = (obj: Record<string, unknown>, msg: string) => {
        if (typeof obj === "object" && obj !== null && "event" in obj) {
          infoEvents.push({ event: obj.event as string, msg, fields: obj });
        }
        return origInfo(obj, msg);
      };
      return { capturingLogger, infoEvents };
    }

    // Drives a multi-page bundle (3 pages) so the fetch-page counter is actually
    // exercised past 1, proving monotonic increment rather than a single no-op tick.
    function makeMultiPageDownloader(): Downloader {
      return {
        downloadBundle: async (input) => {
          const totalPages = input.chapters.reduce((sum, c) => sum + c.pages.length, 0);
          for (let i = 0; i < totalPages; i++) {
            input.onPageProgress?.(totalPages);
          }
          return {
            chapterIds: input.chapters.map((c) => c.id),
            outputPath: join(outDir, "naruto", "naruto-chapter-001.cbz"),
            byteSize: 100,
          };
        },
      };
    }

    test("bar enabled (progressEnabled=true) → per-page log suppressed, chapter-level logs unaffected", async () => {
      const { capturingLogger, infoEvents } = makeCapturingLogger();

      const opts: ExecuteWalkthroughInput = {
        ...plan,
        outDir,
        adapter: makeFakeAdapter(),
        logger: capturingLogger,
        progressEnabled: true,
      };

      const result = await executeWalkthrough(opts, {
        downloader: makeMultiPageDownloader(),
        packer: makeFakePacker(),
      });

      expect(result.failed).toBe(0);
      expect(infoEvents.some((e) => e.event === "walkthrough.fetch_page")).toBe(false);
      // chapter/bundle-level logs still fire
      expect(infoEvents.some((e) => e.event === "walkthrough.execute_start")).toBe(true);
      expect(infoEvents.some((e) => e.event === "walkthrough.download_bundle_done")).toBe(true);
    });

    test("bar disabled (progressEnabled=false) → per-page log present with correct shape, message, and monotonic counter (non-TTY/no --progress fallback)", async () => {
      const { capturingLogger, infoEvents } = makeCapturingLogger();

      const multiPageAdapter = makeFakeAdapter({
        fetchChapterInput: async () => ({
          ...fakeChapterInput,
          pages: [
            { url: "https://example.com/page1.jpg", page: 1 },
            { url: "https://example.com/page2.jpg", page: 2 },
            { url: "https://example.com/page3.jpg", page: 3 },
          ],
        }),
      });

      const opts: ExecuteWalkthroughInput = {
        ...plan,
        outDir,
        adapter: multiPageAdapter,
        logger: capturingLogger,
        progressEnabled: false,
      };

      const result = await executeWalkthrough(opts, {
        downloader: makeMultiPageDownloader(),
        packer: makeFakePacker(),
      });

      expect(result.failed).toBe(0);
      const fetchPageEvents = infoEvents.filter((e) => e.event === "walkthrough.fetch_page");
      // 3-page bundle -> counter increments once per page, ending at total.
      expect(fetchPageEvents.length).toBe(3);
      expect(fetchPageEvents.map((e) => e.fields.completed)).toEqual([1, 2, 3]);

      const lastEvent = fetchPageEvents[fetchPageEvents.length - 1];
      expect(lastEvent).toBeDefined();
      expect(lastEvent?.fields).toEqual({
        event: "walkthrough.fetch_page",
        context: "walkthrough",
        completed: 3,
        total: 3,
        bundle_id: "hit-1-ch-1",
      });
      expect(lastEvent?.fields.completed).toBe(lastEvent?.fields.total);
      expect("page" in (lastEvent?.fields ?? {})).toBe(false);
      expect(lastEvent?.msg).toBe("fetched 3/3 pages of Chapter 1");

      expect(infoEvents.some((e) => e.event === "walkthrough.download_bundle_done")).toBe(true);
    });

    test("progressEnabled omitted (defaults to false, e.g. json mode) → per-page log present", async () => {
      const { capturingLogger, infoEvents } = makeCapturingLogger();

      const opts: ExecuteWalkthroughInput = {
        ...plan,
        outDir,
        adapter: makeFakeAdapter(),
        logger: capturingLogger,
        // progressEnabled intentionally omitted — json mode never constructs a bar, so
        // callers pass progressEnabled: false (or omit it) in that path too.
      };

      const result = await executeWalkthrough(opts, {
        downloader: makeMultiPageDownloader(),
        packer: makeFakePacker(),
      });

      expect(result.failed).toBe(0);
      expect(infoEvents.some((e) => e.event === "walkthrough.fetch_page")).toBe(true);
    });
  });
});
