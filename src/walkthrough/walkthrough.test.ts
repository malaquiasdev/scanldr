import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChapterInput } from "@integrations/_shared/media.ts";
import { CloudflareError } from "../integrations/fallback-http/types.ts";
import type { PackedChapter } from "../pack/index.ts";
import type { Config } from "../plugins/config/index.ts";
import { createLogger } from "../plugins/logger/index.ts";
import type { SourceAdapter } from "../sources/adapters/index.ts";
import type { ChapterListing, Downloader, Packer, SearchHit } from "./types.ts";
import { WalkthroughError } from "./types.ts";

const noop = () => {};
const logger = createLogger({ level: "info", format: "human", write: noop });
const outDir = join(tmpdir(), `walkthrough-test-${Date.now()}`);

/**
 * Mangakakalot (the sole remaining source, #177) requiresAuth === true, so runWalkthrough
 * now always exercises checkAuth. Tests inject an isolated dataHome pre-seeded with a valid
 * auth.json so the file-presence check passes without a real network probe or editor paste.
 */
function makeAuthedDataHome(): string {
  const dir = join(tmpdir(), `walkthrough-authhome-${Date.now()}-${Math.random()}`);
  mkdirSync(join(dir, "scanldr"), { recursive: true });
  writeFileSync(
    join(dir, "scanldr", "auth.json"),
    JSON.stringify({ cookies: { session: "fake" }, userAgent: "test", savedAt: Date.now() }),
  );
  return dir;
}

const fakeHits: SearchHit[] = [
  { id: "mock-1", title: "Naruto", originalLanguage: "ja", year: 1999 },
];

const fakeChapters: ChapterListing[] = [
  { id: "mock-1-ch-1", num: "1", label: "Chapter 1" },
  { id: "mock-1-ch-2", num: "2", label: "Chapter 2" },
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
      outputPath: join(outDir, input.slug, "packed-volume.cbz"),
      byteSize: 200,
    })),
    deleteIndividualFiles: mock(async (chapters: PackedChapter[]) =>
      chapters.map((c) => c.outputPath),
    ),
  };
}

const fakeAdapterFactory = (_sourceId: string, _opts: unknown): SourceAdapter => makeFakeAdapter();

describe("runWalkthrough — full happy path", () => {
  test("happy path → returns assembled plan with selected chapter bundles", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => "Naruto", // title
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mock-1"; // search result
        return "quit"; // next-action
      },
      checkbox: async () => ["mock-1-ch-1", "mock-1-ch-2"],
      confirm: async () => true,
      editor: async () => "",
    }));

    selectCall = 0;
    const fakeDownloader = makeFakeDownloader();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      outDir,
      adapterFactory: fakeAdapterFactory,
      executeDeps: { downloader: fakeDownloader, packer: makeFakePacker() },
    });
    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.selectedBundles).toHaveLength(2);
    // downloader called once per selected chapter
    expect((fakeDownloader.downloadBundle as ReturnType<typeof mock>).mock.calls.length).toBe(2);
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
      editor: async () => {
        throw new ExitPromptError("User force closed the prompt");
      },
    }));

    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      adapterFactory: fakeAdapterFactory,
    });
    expect(result).toEqual({ cancelled: true });
  });

  test("non-CF error from search → propagates as { ok: false } without retry", async () => {
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => opts.default ?? "Some Manga",
      select: async () => "quit",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));

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
        dataHome: makeAuthedDataHome(),
        probeClientFactory: null,
        adapterFactory: () => failAdapter,
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
        if (selectCall === 1) return "mock-1"; // search result
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
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      outDir,
      adapterFactory: () => fakeAdapter,
      refreshFn: async () => {
        refreshCallCount++;
      },
      executeDeps: { downloader: fakeDownloader, packer: makeFakePacker() },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(searchCallCount).toBe(2);
    expect(refreshCallCount).toBe(1);
  });

  test("search hits CF, refresh fails on second probe → returns { ok: false }", async () => {
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => opts.default ?? "Naruto",
      select: async () => "quit",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));

    const cfError = new CloudflareError("https://example.com/cf-rejected");
    const fakeAdapter = makeFakeAdapter({
      search: async () => {
        throw cfError;
      },
    });
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      adapterFactory: () => fakeAdapter,
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
        if (selectCall === 1) return "mock-1";
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
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      outDir,
      adapterFactory: () => fakeAdapter,
      refreshFn: async () => {
        refreshCallCount++;
      },
      executeDeps: { downloader: fakeDownloader, packer: makeFakePacker() },
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
        if (selectCall === 1) return "mock-1";
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
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      outDir,
      adapterFactory: () => fakeAdapter,
      refreshFn: async () => {
        refreshCallCount++;
      },
      executeDeps: { downloader: fakeDownloader, packer: makeFakePacker() },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(fetchCallCount).toBe(2);
    expect(refreshCallCount).toBe(1);
  });

  test("empty search results → returns { ok: false, reason: WalkthroughError message }", async () => {
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => opts.default ?? "Unknown Manga",
      select: async () => "quit",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));

    const emptyAdapter = makeFakeAdapter({ search: async () => [] });
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
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
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => opts.default ?? "Naruto",
      select: async () => "quit",
      checkbox: async () => [],
      confirm: async () => false,
      editor: async () => "",
    }));

    const testConfig: Config = {
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
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      config: testConfig,
      adapterFactory: (sourceId, opts) => {
        captured.call = { sourceId, config: opts.config };
        return emptyAdapter;
      },
    });

    expect(readCapturedCall()).not.toBeUndefined();
    expect(readCapturedCall()?.sourceId).toBe("mangakakalot");
    expect(readCapturedCall()?.config).toBe(testConfig);
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
        if (selectCall === 1) return "mock-1"; // search result
        if (selectCall === 2) return "same-manga"; // next-action after iteration 1
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
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: makeFakePacker() },
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
    mock.module("./prompts.ts", () => ({
      input: async () => {
        inputCall++;
        return inputCall === 1 ? "Naruto" : "Bleach";
      },
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mock-1"; // search result (iteration 1)
        if (selectCall === 2) return "new-manga"; // next-action after iteration 1
        if (selectCall === 3) return "mock-1"; // search result (iteration 2, new manga)
        return "quit"; // next-action after iteration 2
      },
      checkbox: async () => ["mock-1-ch-1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    let searchCallCount = 0;
    let authCallCount = 0;
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
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      outDir,
      adapterFactory: (sourceId, factoryOpts) => {
        authCallCount++;
        expect(sourceId).toBe("mangakakalot");
        expect(factoryOpts).toBeDefined();
        return fakeAdapter;
      },
      executeDeps: { downloader: fakeDownloader, packer: makeFakePacker() },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(authCallCount).toBe(1); // adapter (post-auth) resolved once, reused
    expect(searchCallCount).toBe(2); // new manga re-searches
    expect(inputCall).toBe(2); // title re-prompted for the new manga
    // "new manga" resets the listing cache: iteration 2 must fetch its own chapter
    // listing fresh, not reuse iteration 1's cached listing.
    expect(listChaptersCallCount).toBe(2);
  });

  test("'Quit' after a download exits cleanly with the completed result", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mock-1";
        return "quit";
      },
      checkbox: async () => ["mock-1-ch-1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    const fakeAdapter = makeFakeAdapter();
    const fakeDownloader = makeFakeDownloader();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: makeFakePacker() },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.selectedBundles).toHaveLength(1);
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
        if (selectCall === 1) return "mock-1";
        throw new ExitPromptError("User force closed the prompt");
      },
      checkbox: async () => ["mock-1-ch-1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    const fakeAdapter = makeFakeAdapter();
    const fakeDownloader = makeFakeDownloader();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: makeFakePacker() },
    });

    expect(result).toEqual({ cancelled: true });
  });

  test("3 'same manga' iterations: chapter listing fetched once, reused across all iterations", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mock-1";
        if (selectCall === 2) return "same-manga";
        if (selectCall === 3) return "same-manga";
        return "quit";
      },
      checkbox: async () => ["mock-1-ch-1"],
      confirm: async () => false,
      editor: async () => "",
    }));

    let listChaptersCallCount = 0;
    const fakeAdapter = makeFakeAdapter({
      listChapters: async () => {
        listChaptersCallCount++;
        return fakeChapters;
      },
    });
    const fakeDownloader = makeFakeDownloader();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: makeFakePacker() },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    // chapter listing fetched once (iter 1) and reused in iters 2-3
    expect(listChaptersCallCount).toBe(1);
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
        if (selectCall === 1) return "mock-1";
        if (selectCall === 2) return "same-manga"; // proves loop still offers next-action
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
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger: warnLogger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: makeFakePacker() },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    // loop resumed after partial failure ("same manga") and completed a second iteration
    expect(result.selectedBundles.length).toBeGreaterThan(0);
    expect(warnMessages.some((line) => /chapter\(s\) failed to download/.test(line))).toBe(true);
  });

  test("partial download failure then 'quit' returns the completed result", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mock-1";
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
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: makeFakePacker() },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.selectedBundles.length).toBeGreaterThan(0);
  });
});

describe("runWalkthrough — chapter→volume grouping (#183)", () => {
  test("group=yes → downloader runs per-chapter, then packer.packVolume packs one volume cbz", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async (opts: { default?: string }) => opts.default ?? "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mock-1"; // search result
        return "quit"; // next-action
      },
      checkbox: async () => ["mock-1-ch-1", "mock-1-ch-2"],
      confirm: async () => true, // group into volume: yes
      editor: async () => "",
    }));

    selectCall = 0;
    const fakeAdapter = makeFakeAdapter();
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.groupIntoVolume).toBe(true);
    // one downloadBundle call per selected chapter
    expect((fakeDownloader.downloadBundle as ReturnType<typeof mock>).mock.calls.length).toBe(2);
    // exactly one packVolume call producing the single volume cbz
    expect((fakePacker.packVolume as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  test("group=no → per-chapter cbz only, packer never invoked", async () => {
    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async () => "Naruto",
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mock-1";
        return "quit";
      },
      checkbox: async () => ["mock-1-ch-1", "mock-1-ch-2"],
      confirm: async () => false, // group into volume: no
      editor: async () => "",
    }));

    selectCall = 0;
    const fakeAdapter = makeFakeAdapter();
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.groupIntoVolume).toBe(false);
    expect((fakeDownloader.downloadBundle as ReturnType<typeof mock>).mock.calls.length).toBe(2);
    expect((fakePacker.packVolume as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  // P1 (#183 QA gap) — group=yes WITH a cover URL supplied: assert the fetched
  // cover bytes are threaded end-to-end into packer.packVolume({ cover }).
  test("group=yes with cover URL → fetched cover bytes reach packer.packVolume", async () => {
    const fakeCoverBytes = new Uint8Array([9, 8, 7, 6]);
    mock.module("../pack/cover.ts", () => ({
      fetchCover: mock(async () => ({ bytes: fakeCoverBytes, ext: ".png" })),
    }));

    let selectCall = 0;
    mock.module("./prompts.ts", () => ({
      input: async (opts: { message: string; default?: string }) => {
        if (opts.message.includes("Cover image URL")) return "https://example.com/cover.png";
        return opts.default ?? "Naruto";
      },
      select: async () => {
        selectCall++;
        if (selectCall === 1) return "mock-1"; // search result
        return "quit"; // next-action
      },
      checkbox: async () => ["mock-1-ch-1", "mock-1-ch-2"],
      confirm: async () => true, // group into volume: yes
      editor: async () => "",
    }));

    selectCall = 0;
    const fakeAdapter = makeFakeAdapter();
    const fakeDownloader = makeFakeDownloader();
    const fakePacker = makeFakePacker();
    const { runWalkthrough } = await import("./index.ts");
    const result = await runWalkthrough({
      logger,
      dataHome: makeAuthedDataHome(),
      probeClientFactory: null,
      outDir,
      adapterFactory: () => fakeAdapter,
      executeDeps: { downloader: fakeDownloader, packer: fakePacker },
    });

    if ("cancelled" in result) throw new Error("Unexpected cancellation");
    if ("ok" in result) throw new Error(`Unexpected failure: ${result.reason}`);
    expect(result.groupIntoVolume).toBe(true);

    const packCalls = (fakePacker.packVolume as ReturnType<typeof mock>).mock.calls;
    expect(packCalls.length).toBe(1);
    const packInput = packCalls[0]?.[0] as { cover?: { bytes: Uint8Array; ext: string } };
    expect(packInput.cover).toBeDefined();
    expect(packInput.cover?.bytes.byteLength).toBeGreaterThan(0);
    expect(packInput.cover?.bytes).toEqual(fakeCoverBytes);
    expect(packInput.cover?.ext).toBe(".png");
  });
});
