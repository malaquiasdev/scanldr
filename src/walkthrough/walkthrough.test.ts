import { describe, expect, mock, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChapterInput } from "@integrations/_shared/media.ts";
import { CloudflareError } from "../integrations/fallback-http/types.ts";
import type { Config } from "../plugins/config/index.ts";
import { createLogger } from "../plugins/logger/index.ts";
import type { SourceAdapter } from "../sources/adapters/index.ts";
import type { ChapterListing, Downloader, Packer, SearchHit, VolumeListing } from "./types.ts";
import { WalkthroughError } from "./types.ts";

const noop = () => {};
const logger = createLogger({ level: "info", format: "human", write: noop });
const outDir = join(tmpdir(), `walkthrough-test-${Date.now()}`);

const fakeHits: SearchHit[] = [
  { id: "mock-1", title: "Naruto", originalLanguage: "ja", year: 1999 },
];

const fakeChapters: ChapterListing[] = [
  { id: "mock-1-ch-1", num: "1", label: "Chapter 1" },
  { id: "mock-1-ch-2", num: "2", label: "Chapter 2" },
];

const fakeVolumes: VolumeListing[] = [
  {
    volume: "1",
    label: "Volume 1",
    chapterIds: ["mock-1-ch-1", "mock-1-ch-2"],
    chapterNums: ["1", "2"],
  },
];

const fakeChapterInput: ChapterInput = {
  id: "mock-chapter",
  num: 1,
  pages: [{ url: "https://example.com/page1.jpg", page: 1 }],
  imageFetcher: async () => new Uint8Array([0, 1, 2]),
};

function makeFakeAdapter(overrides: Partial<SourceAdapter> = {}): SourceAdapter {
  return {
    search: async () => fakeHits,
    listChapters: async () => fakeChapters,
    listVolumes: async () => fakeVolumes,
    fetchChapterInput: async () => fakeChapterInput,
    ...overrides,
  };
}

function makeFakeDownloader(): Downloader {
  return {
    downloadBundle: mock(async () => ({
      chapterIds: ["mock-chapter"],
      outputPath: join(outDir, "naruto", "naruto-chapter-001.cbz"),
      byteSize: 100,
    })),
  };
}

function makeFakePacker(): Packer {
  return {
    packVolume: mock(async (input) => ({
      outputPath: join(outDir, "naruto", `${input.slug}-volume-001.cbz`),
      byteSize: 500,
    })),
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
        if (inputCall === 2) return ""; // volume name (keep default)
        return "https://example.com/cover.jpg"; // cover URL
      },
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex"; // source
        if (selectCall === 2) return "mock-1"; // search result
        if (selectCall === 3) return "chapter"; // mode
        return "quit"; // next-action
      },
      checkbox: async () => ["mock-1-ch-1", "mock-1-ch-2"],
      confirm: async () => true,
      editor: async () => "",
    }));

    selectCall = 0;
    inputCall = 0;
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      outDir,
      adapterFactory: fakeAdapterFactory,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });
    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.mode).toBe("chapter");
    expect(result.groupIntoVolume).toBe(true);
    expect(result.coverUrl).toBe("https://example.com/cover.jpg");
    expect(result.selectedBundles).toHaveLength(2);
    // downloader called once per selected chapter
    expect((fakeDownloader.downloadBundle as ReturnType<typeof mock>).mock.calls.length).toBe(2);
    // packer called once for all chapters
    expect((fakePacker.packVolume as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    // PackedChapter.num must be numeric strings, not opaque ids
    const packCall = (fakePacker.packVolume as ReturnType<typeof mock>).mock.calls[0];
    const chapters = (packCall as [{ chapters: Array<{ num: string }> }])[0].chapters;
    for (const ch of chapters) {
      expect(Number.isNaN(Number(ch.num))).toBe(false);
    }
  });

  test("mode=chapter + group=true + custom volume name → packer receives buildVolumeFilename stem", async () => {
    let inputCall = 0;
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => {
        inputCall++;
        if (inputCall === 1) return "Naruto"; // title
        if (inputCall === 2) return "1"; // volume name
        return ""; // cover URL skipped
      },
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        if (selectCall === 2) return "mock-1";
        if (selectCall === 3) return "chapter";
        return "quit"; // next-action
      },
      checkbox: async () => ["mock-1-ch-1"],
      confirm: async () => true,
      editor: async () => "",
    }));

    selectCall = 0;
    inputCall = 0;
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      outDir,
      adapterFactory: fakeAdapterFactory,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });
    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.volumeName).toBe("1");
    const packCall = (fakePacker.packVolume as ReturnType<typeof mock>).mock.calls[0];
    const customName = (packCall as [{ customName?: string }])[0].customName;
    expect(customName).toBe("naruto-volume-1.cbz");
  });

  test("mode=volume (auto-pack) → downloader called per volume, packer called once per volume", async () => {
    let selectCall = 0;
    const fakeAdapter = makeFakeAdapter();
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => opts.default ?? "One Piece",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex"; // source
        if (selectCall === 2) return "mock-1"; // search result
        if (selectCall === 3) return "volume"; // mode
        return "quit"; // next-action
      },
      checkbox: async () => ["vol:1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    selectCall = 0;
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });
    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.mode).toBe("volume");
    expect(result.groupIntoVolume).toBe(true);
    // one volume selected → downloader called once with all chapters in that volume
    expect((fakeDownloader.downloadBundle as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    // volume mode: downloader already produces the final cbz — packer must NOT be called
    expect((fakePacker.packVolume as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  test("mode=chapter + group=false → cover-prompt skipped, coverUrl is null, packer not called", async () => {
    let inputCallCount = 0;
    let selectCall = 0;
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => {
        inputCallCount++;
        return opts.default ?? "Bleach";
      },
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        if (selectCall === 2) return "mock-1";
        if (selectCall === 3) return "chapter";
        return "quit"; // next-action
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
      outDir,
      adapterFactory: fakeAdapterFactory,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });
    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);

    expect(result.coverUrl).toBeNull();
    expect(result.groupIntoVolume).toBe(false);
    expect(inputCallCount - inputCallsBefore).toBe(1); // only title step called input
    expect((fakePacker.packVolume as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  test("Ctrl+C (ExitPromptError) returns { cancelled: true }", async () => {
    const ExitPromptError = class extends Error {
      override name = "ExitPromptError";
    };

    mock.module("./prompts.ts", () => ({
      input: async () => {
        throw new ExitPromptError("User force closed the prompt");
      },
      select: async () => {
        throw new ExitPromptError("User force closed the prompt");
      },
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));

    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({ logger, adapterFactory: fakeAdapterFactory });
    expect(result).toEqual({ cancelled: true });
  });

  test("non-CF error from search → propagates as { ok: false } without retry", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => opts.default ?? "Some Manga",
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
    let searchCallCount = 0;
    const failAdapter = makeFakeAdapter({
      search: async () => {
        searchCallCount++;
        throw new Error("unexpected database error");
      },
    });
    let refreshCalled = false;
    const { runWalkthrough } = await import("./index.ts");
    // non-CF errors should bubble up, not be swallowed or retried
    await expect(
      runWalkthrough({
        logger,
        adapterFactory: () => failAdapter,
        probeClientFactory: null,
        refreshFn: async () => {
          refreshCalled = true;
        },
      }),
    ).rejects.toThrow("unexpected database error");
    expect(searchCallCount).toBe(1);
    expect(refreshCalled).toBe(false);
  });

  test("search hits CF first time, refresh succeeds, retry returns hits → success", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => opts.default ?? "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex"; // source
        if (selectCall === 2) return "mock-1"; // search result
        if (selectCall === 3) return "chapter"; // mode
        return "quit"; // next-action
      },
      checkbox: async () => ["mock-1-ch-1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    selectCall = 0;
    let searchCallCount = 0;
    const cfError = new CloudflareError("https://example.com/cf-rejected");
    const fakeAdapter = makeFakeAdapter({
      search: async () => {
        searchCallCount++;
        if (searchCallCount === 1) throw cfError;
        return fakeHits;
      },
    });
    let refreshCallCount = 0;
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      outDir,
      adapterFactory: () => fakeAdapter,
      probeClientFactory: null,
      refreshFn: async () => {
        refreshCallCount++;
      },
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(searchCallCount).toBe(2);
    expect(refreshCallCount).toBe(1);
  });

  test("search hits CF, refresh fails on second probe → returns { ok: false }", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => opts.default ?? "Naruto",
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
    const cfError = new CloudflareError("https://example.com/cf-rejected");
    const fakeAdapter = makeFakeAdapter({
      search: async () => {
        throw cfError;
      },
    });
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      adapterFactory: () => fakeAdapter,
      probeClientFactory: null,
      refreshFn: async () => {
        throw new WalkthroughError("Session refresh failed twice. Try again later.");
      },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    expect("ok" in result && result.ok === false).toBe(true);
    if ("ok" in result) {
      expect(result.reason).toMatch(/refresh failed/i);
    }
  });

  test("listChapters hits CF, refresh succeeds, retry returns chapters → success", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => opts.default ?? "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        if (selectCall === 2) return "mock-1";
        if (selectCall === 3) return "chapter";
        return "quit"; // next-action
      },
      checkbox: async () => ["mock-1-ch-1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    selectCall = 0;
    let listChaptersCallCount = 0;
    const cfError = new CloudflareError("https://example.com/cf-rejected");
    const fakeAdapter = makeFakeAdapter({
      listChapters: async () => {
        listChaptersCallCount++;
        if (listChaptersCallCount === 1) throw cfError;
        return fakeChapters;
      },
    });
    let refreshCallCount = 0;
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      outDir,
      adapterFactory: () => fakeAdapter,
      probeClientFactory: null,
      refreshFn: async () => {
        refreshCallCount++;
      },
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(listChaptersCallCount).toBe(2);
    expect(refreshCallCount).toBe(1);
  });

  test("fetchChapterInput hits CF, refresh succeeds, retry completes → success", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => opts.default ?? "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        if (selectCall === 2) return "mock-1";
        if (selectCall === 3) return "chapter";
        return "quit"; // next-action
      },
      checkbox: async () => ["mock-1-ch-1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    selectCall = 0;
    let fetchCallCount = 0;
    const cfError = new CloudflareError("https://example.com/cf-rejected");
    const fakeAdapter = makeFakeAdapter({
      fetchChapterInput: async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) throw cfError;
        return fakeChapterInput;
      },
    });
    let refreshCallCount = 0;
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      outDir,
      adapterFactory: () => fakeAdapter,
      probeClientFactory: null,
      refreshFn: async () => {
        refreshCallCount++;
      },
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(fetchCallCount).toBe(2);
    expect(refreshCallCount).toBe(1);
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
      adapterFactory: () => emptyAdapter,
    });
    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    expect("ok" in result && result.ok === false).toBe(true);
    if ("ok" in result) {
      expect(result.reason).toMatch(/No results found/);
    }
  });
});

describe("runWalkthrough — config threading to adapter factory", () => {
  test("opts.config is forwarded to adapterFactory unchanged (end-to-end wiring)", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => opts.default ?? "Naruto",
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
    const testConfig: Config = {
      preferred_languages: ["pt-br"],
      download_quality: "data",
      default_format: "cbz",
      default_out: ".",
      db_path: "",
      image_concurrency: 4,
      chapter_delay_ms: 500,
    };

    interface CapturedFactoryCall {
      sourceId: string;
      config?: Config;
    }
    const captured: { call: CapturedFactoryCall | undefined } = { call: undefined };
    /** Reads through a function boundary to defeat TS narrowing across the closure assignment. */
    function readCapturedCall(): CapturedFactoryCall | undefined {
      return captured.call;
    }
    const emptyAdapter = makeFakeAdapter({ search: async () => [] });
    const { runWalkthrough } = await import("./index.ts");
    await runWalkthrough({
      logger,
      config: testConfig,
      adapterFactory: (sourceId, opts) => {
        captured.call = { sourceId, config: opts.config };
        return emptyAdapter;
      },
    });

    expect(readCapturedCall()).not.toBeUndefined();
    expect(readCapturedCall()?.sourceId).toBe("mangadex");
    expect(readCapturedCall()?.config).toBe(testConfig);
    expect(readCapturedCall()?.config?.preferred_languages).toEqual(["pt-br"]);
  });
});

describe("runWalkthrough — post-download loop", () => {
  test("'Same manga' reuses the cached chapter list: adapter.search/listChapters called once each", async () => {
    let inputCall = 0;
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => {
        inputCall++;
        return "Naruto"; // title (only asked once, "new manga" path not taken)
      },
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex"; // source
        if (selectCall === 2) return "mock-1"; // search result
        if (selectCall === 3) return "chapter"; // mode (iteration 1)
        if (selectCall === 4) return "same-manga"; // next-action after iteration 1
        if (selectCall === 5) return "chapter"; // mode (iteration 2, same manga)
        return "quit"; // next-action after iteration 2
      },
      checkbox: async () => ["mock-1-ch-1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    let searchCallCount = 0;
    let listChaptersCallCount = 0;
    const fakeAdapter = makeFakeAdapter({
      search: async () => {
        searchCallCount++;
        return fakeHits;
      },
      listChapters: async () => {
        listChaptersCallCount++;
        return fakeChapters;
      },
    });
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(searchCallCount).toBe(1);
    expect(listChaptersCallCount).toBe(1);
    expect(inputCall).toBe(1);
    // downloader called once per iteration (1 chapter selected each time)
    expect((fakeDownloader.downloadBundle as ReturnType<typeof mock>).mock.calls.length).toBe(2);
  });

  test("'New manga' returns to title/search without re-picking source or redoing auth", async () => {
    let inputCall = 0;
    let selectCall = 0;
    let sourceSelectCount = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => {
        inputCall++;
        return inputCall === 1 ? "Naruto" : "Bleach";
      },
      select: async () => {
        selectCall++;
        if (selectCall === 1) {
          sourceSelectCount++;
          return "mangadex"; // source (picked once)
        }
        if (selectCall === 2) return "mock-1"; // search result (iteration 1)
        if (selectCall === 3) return "chapter"; // mode (iteration 1)
        if (selectCall === 4) return "new-manga"; // next-action after iteration 1
        if (selectCall === 5) return "mock-1"; // search result (iteration 2, new manga)
        if (selectCall === 6) return "chapter"; // mode (iteration 2)
        return "quit"; // next-action after iteration 2
      },
      checkbox: async () => ["mock-1-ch-1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    let searchCallCount = 0;
    let authCallCount = 0;
    let listChaptersCallCount = 0;
    let listVolumesCallCount = 0;
    const fakeAdapter = makeFakeAdapter({
      search: async () => {
        searchCallCount++;
        return fakeHits;
      },
      listChapters: async () => {
        listChaptersCallCount++;
        return fakeChapters;
      },
      listVolumes: async () => {
        listVolumesCallCount++;
        return fakeVolumes;
      },
    });
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      outDir,
      adapterFactory: (sourceId, factoryOpts) => {
        authCallCount++;
        expect(sourceId).toBe("mangadex");
        expect(factoryOpts).toBeDefined();
        return fakeAdapter;
      },
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(sourceSelectCount).toBe(1); // source only picked once
    expect(authCallCount).toBe(1); // adapter (post-auth) resolved once, reused
    expect(searchCallCount).toBe(2); // new manga re-searches
    expect(inputCall).toBe(2); // title re-prompted for the new manga
    // "new manga" resets the listing cache: iteration 2 must fetch its own chapter
    // listing fresh, not reuse iteration 1's cached listing.
    expect(listChaptersCallCount).toBe(2);
    expect(listVolumesCallCount).toBe(0);
  });

  test("'Quit' after a download exits cleanly with the completed result", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        if (selectCall === 2) return "mock-1";
        if (selectCall === 3) return "chapter";
        return "quit";
      },
      checkbox: async () => ["mock-1-ch-1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    const fakeAdapter = makeFakeAdapter();
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.mode).toBe("chapter");
  });

  test("Ctrl+C at the post-download 'what next?' prompt returns { cancelled: true }", async () => {
    const ExitPromptError = class extends Error {
      override name = "ExitPromptError";
    };
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        if (selectCall === 2) return "mock-1";
        if (selectCall === 3) return "chapter";
        throw new ExitPromptError("User force closed the prompt");
      },
      checkbox: async () => ["mock-1-ch-1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    const fakeAdapter = makeFakeAdapter();
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    expect(result).toEqual({ cancelled: true });
  });

  test("'Same manga' allows switching from chapter mode to volume mode across iterations", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        if (selectCall === 2) return "mock-1";
        if (selectCall === 3) return "chapter"; // iteration 1: chapter mode
        if (selectCall === 4) return "same-manga";
        if (selectCall === 5) return "volume"; // iteration 2: volume mode
        return "quit";
      },
      checkbox: async (opts: { message: string }) => {
        if (opts.message.includes("volumes")) return ["vol:1"];
        return ["mock-1-ch-1"];
      },
      confirm: async () => false,
      editor: async () => "",
    }));

    let listVolumesCallCount = 0;
    const fakeAdapter = makeFakeAdapter({
      listVolumes: async () => {
        listVolumesCallCount++;
        return fakeVolumes;
      },
    });
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.mode).toBe("volume");
    expect(listVolumesCallCount).toBe(1);
  });

  test("'Same manga' allows switching from volume mode to chapter mode across iterations", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        if (selectCall === 2) return "mock-1";
        if (selectCall === 3) return "volume"; // iteration 1: volume mode
        if (selectCall === 4) return "same-manga";
        if (selectCall === 5) return "chapter"; // iteration 2: chapter mode
        return "quit";
      },
      checkbox: async (opts: { message: string }) => {
        if (opts.message.includes("volumes")) return ["vol:1"];
        return ["mock-1-ch-1"];
      },
      confirm: async () => false,
      editor: async () => "",
    }));

    let listChaptersCallCount = 0;
    let listVolumesCallCount = 0;
    const fakeAdapter = makeFakeAdapter({
      listChapters: async () => {
        listChaptersCallCount++;
        return fakeChapters;
      },
      listVolumes: async () => {
        listVolumesCallCount++;
        return fakeVolumes;
      },
    });
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.mode).toBe("chapter");
    expect(listVolumesCallCount).toBe(1);
    expect(listChaptersCallCount).toBe(1);
  });

  test("3 iterations chapter->volume->chapter (same manga): no stale cache leak, each listing fetched once", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        if (selectCall === 2) return "mock-1";
        if (selectCall === 3) return "chapter"; // iteration 1: chapter mode
        if (selectCall === 4) return "same-manga";
        if (selectCall === 5) return "volume"; // iteration 2: volume mode
        if (selectCall === 6) return "same-manga";
        if (selectCall === 7) return "chapter"; // iteration 3: chapter mode (reuse iter-1 cache)
        return "quit";
      },
      checkbox: async (opts: { message: string }) => {
        if (opts.message.includes("volumes")) return ["vol:1"];
        return ["mock-1-ch-1"];
      },
      confirm: async () => false,
      editor: async () => "",
    }));

    let listChaptersCallCount = 0;
    let listVolumesCallCount = 0;
    const fakeAdapter = makeFakeAdapter({
      listChapters: async () => {
        listChaptersCallCount++;
        return fakeChapters;
      },
      listVolumes: async () => {
        listVolumesCallCount++;
        return fakeVolumes;
      },
    });
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.mode).toBe("chapter");
    // chapter listing fetched once (iter 1) and reused in iter 3, not re-fetched
    expect(listChaptersCallCount).toBe(1);
    // volume listing fetched once (iter 2)
    expect(listVolumesCallCount).toBe(1);
    // downloader called once per iteration
    expect((fakeDownloader.downloadBundle as ReturnType<typeof mock>).mock.calls.length).toBe(3);
  });

  test("partial download failure: loop still reaches next-action prompt and logs a failure summary", async () => {
    let selectCall = 0;
    const warnMessages: string[] = [];
    const warnLogger = createLogger({
      level: "info",
      format: "human",
      write: (line: string) => {
        warnMessages.push(line);
      },
    });
    mock.module("./prompts.ts", () => ({
      input: async () => "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        if (selectCall === 2) return "mock-1";
        if (selectCall === 3) return "chapter"; // iteration 1
        if (selectCall === 4) return "same-manga"; // proves loop still offers next-action
        if (selectCall === 5) return "chapter"; // iteration 2
        return "quit";
      },
      checkbox: async () => ["mock-1-ch-1", "mock-1-ch-2"],
      confirm: async () => false,
      editor: async () => "",
    }));

    let fetchCallCount = 0;
    const fakeAdapter = makeFakeAdapter({
      fetchChapterInput: async (id: string, num?: string) => {
        fetchCallCount++;
        if (fetchCallCount === 1) throw new Error("upstream 500");
        return { ...fakeChapterInput, id, num: num ? Number(num) : fakeChapterInput.num };
      },
    });
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger: warnLogger,
      outDir,
      adapterFactory: () => fakeAdapter,
      probeClientFactory: null,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    // loop resumed after partial failure ("same manga") and completed a second iteration
    expect(result.mode).toBe("chapter");
    expect(warnMessages.some((line) => /chapter\(s\) failed to download/.test(line))).toBe(true);
  });

  test("partial download failure then 'quit' returns the completed result", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mangadex";
        if (selectCall === 2) return "mock-1";
        if (selectCall === 3) return "chapter";
        return "quit";
      },
      checkbox: async () => ["mock-1-ch-1", "mock-1-ch-2"],
      confirm: async () => false,
      editor: async () => "",
    }));

    let fetchCallCount = 0;
    const fakeAdapter = makeFakeAdapter({
      fetchChapterInput: async (id: string, num?: string) => {
        fetchCallCount++;
        if (fetchCallCount === 1) throw new Error("upstream 500");
        return { ...fakeChapterInput, id, num: num ? Number(num) : fakeChapterInput.num };
      },
    });
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      outDir,
      adapterFactory: () => fakeAdapter,
      probeClientFactory: null,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.mode).toBe("chapter");
  });
});
