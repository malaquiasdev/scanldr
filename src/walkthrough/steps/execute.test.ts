import { describe, expect, mock, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChapterInput } from "@integrations/_shared/media.ts";
import { CloudflareError } from "../../integrations/fallback-http/types.ts";
import { MangakakalotParseError } from "../../integrations/mangakakalot/client/types.ts";
import type { PackVolumeInput } from "../../pack/types.ts";
import { createLogger } from "../../plugins/logger/index.ts";
import type { SourceAdapter } from "../../sources/adapters/index.ts";
import { getSource } from "../../sources/index.ts";
import type { Downloader, Packer, ProgressHandle, WalkthroughResult } from "../types.ts";
import { WalkthroughError } from "../types.ts";
import type { ExecuteWalkthroughInput } from "./execute.ts";
import { executeWalkthrough } from "./execute.ts";

const source = getSource("mangakakalot");

const plan: WalkthroughResult = {
  title: "Naruto",
  source,
  hit: { id: "hit-1", title: "Naruto", originalLanguage: "ja", year: 1999 },
  selectedBundles: [{ label: "Chapter 1", id: "hit-1-ch-1", num: "1" }],
  groupIntoVolume: false,
  volumeName: null,
  coverUrl: null,
};

function makeFakePacker(overrides: Partial<Packer> = {}): Packer {
  return {
    packVolumeReplacingSources: mock(async (input: PackVolumeInput) => ({
      volume: {
        outputPath: join(outDir, input.slug, "packed-volume.cbz"),
        byteSize: 200,
      },
      deleted: input.chapters.map((c) => c.outputPath),
    })),
    ...overrides,
  };
}

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

    const bundle1 = { label: "Chapter 1", id: "ch-1", num: "1" };
    const bundle2 = { label: "Chapter 2", id: "ch-2", num: "2" };

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

  test("#173 P1: progress.finish() still runs when a MangakakalotParseError aborts execution (error-path teardown)", async () => {
    const finishCalls: string[] = [];
    const fakeProgress: ProgressHandle = {
      updateChapter: () => {},
      updatePage: () => {},
      finish: () => finishCalls.push("finish"),
    };
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
      progress: fakeProgress,
    };

    await expect(
      executeWalkthrough(opts, { downloader: makeFakeDownloader(), packer: makeFakePacker() }),
    ).rejects.toBeInstanceOf(MangakakalotParseError);

    expect(finishCalls).toEqual(["finish"]);
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

  test("downloadBundle receives bundle.num (numeric), not bundle.id (opaque)", async () => {
    const capturedBundleNumbers: string[] = [];
    const opts: ExecuteWalkthroughInput = {
      ...plan,
      selectedBundles: [{ label: "Chapter 103.5", id: "naruto/chapter-103.5", num: "103.5" }],
      outDir,
      adapter: makeFakeAdapter(),
      logger,
    };

    await executeWalkthrough(opts, {
      downloader: makeFakeDownloader({
        downloadBundle: mock(async (input) => {
          capturedBundleNumbers.push(input.bundleNumber);
          return {
            chapterIds: ["naruto/chapter-103.5"],
            outputPath: join(outDir, "out.cbz"),
            byteSize: 1,
          };
        }),
      }),
      packer: makeFakePacker(),
    });

    expect(capturedBundleNumbers[0]).toBe("103.5");
    expect(capturedBundleNumbers[0]).not.toContain("/");
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

    // Fake downloader that fires onPageCompleted OUT of dispatch order (highest index first),
    // simulating real concurrent fetches where completion order != dispatch order.
    const fakeDownloader: Downloader = {
      downloadBundle: async (input) => {
        const totalPages = input.chapters.reduce((sum, c) => sum + c.pages.length, 0);
        for (let i = totalPages; i >= 1; i--) {
          input.onPageCompleted?.(totalPages);
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
            input.onPageCompleted?.(totalPages);
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

  // P2 (#183 QA gap) — groupIntoVolume=true but one chapter fails: pack step
  // must be skipped (gated on failed === 0), and the surviving per-chapter
  // output is still returned.
  test("groupIntoVolume=true with one failed chapter → pack skipped, surviving output still returned", async () => {
    const bundle1 = { label: "Chapter 1", id: "ch-1", num: "1" };
    const bundle2 = { label: "Chapter 2", id: "ch-2", num: "2" };

    const adapter = makeFakeAdapter({
      fetchChapterInput: async (id, num) => {
        if (id === "ch-2") throw new Error("network error");
        return { ...fakeChapterInput, id, num: Number(num ?? "0") };
      },
    });
    const packer = makeFakePacker();

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      selectedBundles: [bundle1, bundle2],
      groupIntoVolume: true,
      outDir,
      adapter,
      logger,
    };

    const result = await executeWalkthrough(opts, { downloader: makeFakeDownloader(), packer });

    expect(result.failed).toBe(1);
    // bundle 1 succeeded, its output survives the partial-group failure
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]).toContain("naruto-chapter-001.cbz");
    // pack step is gated on failed === 0 — must not run (and so neither does its deletion)
    expect((packer.packVolumeReplacingSources as ReturnType<typeof mock>).mock.calls.length).toBe(
      0,
    );
  });

  // #183 — product decision: after a successful group pack, delete the loose
  // per-chapter .cbz files so only the volume remains on disk.
  test("groupIntoVolume=true success → deletes exactly the packed per-chapter files, keeps the volume", async () => {
    const bundle1 = { label: "Chapter 1", id: "ch-1", num: "1" };
    const bundle2 = { label: "Chapter 2", id: "ch-2", num: "2" };

    const adapter = makeFakeAdapter({
      fetchChapterInput: async (id, num) => ({ ...fakeChapterInput, id, num: Number(num ?? "0") }),
    });
    const packer = makeFakePacker();

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      selectedBundles: [bundle1, bundle2],
      groupIntoVolume: true,
      outDir,
      adapter,
      logger,
    };

    const result = await executeWalkthrough(opts, { downloader: makeFakeDownloader(), packer });

    expect(result.failed).toBe(0);

    const packMock = packer.packVolumeReplacingSources as ReturnType<typeof mock>;
    expect(packMock.mock.calls.length).toBe(1);
    const [packInput] = packMock.mock.calls[0] as [
      { chapters: { num: string; outputPath: string }[] },
    ];
    expect(packInput.chapters.map((c) => c.num)).toEqual(["1", "2"]);
    expect(packInput.chapters.every((c) => c.outputPath.endsWith(".cbz"))).toBe(true);

    // outputs reflects the final on-disk artifacts: only the volume survives
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]).toContain("packed-volume.cbz");
  });

  test("groupIntoVolume=false → packVolumeReplacingSources never called", async () => {
    const packer = makeFakePacker();

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      groupIntoVolume: false,
      outDir,
      adapter: makeFakeAdapter(),
      logger,
    };

    const result = await executeWalkthrough(opts, { downloader: makeFakeDownloader(), packer });

    expect(result.failed).toBe(0);
    expect((packer.packVolumeReplacingSources as ReturnType<typeof mock>).mock.calls.length).toBe(
      0,
    );
  });

  test("groupIntoVolume=true, deletion of one file fails → run still succeeds, volume intact, surviving file stays in outputs", async () => {
    const bundle1 = { label: "Chapter 1", id: "ch-1", num: "1" };
    const bundle2 = { label: "Chapter 2", id: "ch-2", num: "2" };

    const chapter1Path = join(outDir, "naruto", "naruto-chapter-001.cbz");
    const chapter2Path = join(outDir, "naruto", "naruto-chapter-002.cbz");

    const downloader = makeFakeDownloader({
      downloadBundle: mock(async (input) => {
        const bundleNum = (input as { bundleNumber: string }).bundleNumber;
        return {
          chapterIds: [bundleNum === "1" ? "ch-1" : "ch-2"],
          outputPath: bundleNum === "1" ? chapter1Path : chapter2Path,
          byteSize: 100,
        };
      }),
    });

    const adapter = makeFakeAdapter({
      fetchChapterInput: async (id, num) => ({ ...fakeChapterInput, id, num: Number(num ?? "0") }),
    });

    const warnEvents: Array<{ event?: string; [k: string]: unknown }> = [];
    const capturingLogger = createLogger({ level: "info", format: "human", write: noop });
    const origWarn = capturingLogger.warn.bind(capturingLogger);
    capturingLogger.warn = (obj: Record<string, unknown>, msg: string) => {
      if (typeof obj === "object" && obj !== null && "event" in obj) {
        warnEvents.push({ ...obj });
      }
      return origWarn(obj, msg);
    };

    // Deletion graceful-failure behavior is exercised at the pack.ts unit-test
    // level; here we assert the walkthrough layer doesn't fail the run when the
    // packer reports a partial delete, and that any path NOT reported as
    // deleted stays in outputs (it still exists on disk).
    const packer = makeFakePacker({
      packVolumeReplacingSources: mock(async (input) => {
        capturingLogger.warn(
          { event: "pack.delete_failed", context: "pack", path: chapter2Path },
          `failed to delete ${chapter2Path}`,
        );
        return {
          volume: {
            outputPath: join(outDir, input.slug, "packed-volume.cbz"),
            byteSize: 200,
          },
          deleted: [chapter1Path],
        };
      }),
    });

    const opts: ExecuteWalkthroughInput = {
      ...plan,
      selectedBundles: [bundle1, bundle2],
      groupIntoVolume: true,
      outDir,
      adapter,
      logger: capturingLogger,
    };

    const result = await executeWalkthrough(opts, { downloader, packer });

    expect(result.failed).toBe(0);
    // volume + the surviving (undeleted) chapter2 file
    expect(result.outputs).toHaveLength(2);
    expect(result.outputs.some((o) => o.includes("packed-volume.cbz"))).toBe(true);
    expect(result.outputs).toContain(chapter2Path);
    expect(result.outputs).not.toContain(chapter1Path);
    expect(warnEvents.some((e) => e.event === "pack.delete_failed")).toBe(true);
  });
});
