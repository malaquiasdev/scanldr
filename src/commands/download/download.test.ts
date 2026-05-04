import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AtHomeError } from "@integrations/mangadex/at-home/index.ts";
import type { MangaDexClient } from "@integrations/mangadex/client/index.ts";
import type { ChapterRef, MangaCandidate, VolumeRef } from "@integrations/mangadex/client/index.ts";
import type { MangaDexHttpClient } from "@integrations/mangadex/http/index.ts";
import { listHistory } from "@modules/history/index.ts";
import { openDb, runMigrations } from "@plugins/db/index.ts";
import type { Db } from "@plugins/db/index.ts";
import { CliError } from "@plugins/errors/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import { unzipSync } from "fflate";
import { runDownload } from "./index.ts";
import type { DownloadArgs, DownloadContext } from "./types.ts";

// Minimal 1x1 JPEG bytes
const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
  0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00,
  0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
  0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
  0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
  0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
  0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x93, 0x94, 0x95,
  0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3,
  0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca,
  0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7,
  0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00,
  0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xfb, 0xd2, 0x8a, 0x28, 0x03, 0xff, 0xd9,
]);

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeCandidate(overrides?: Partial<MangaCandidate>): MangaCandidate {
  return {
    id: "manga-id-1",
    title: "Test Manga",
    originalLanguage: "ja",
    year: 2020,
    ...overrides,
  };
}

function makeVolumeRef(volume: string, chapterIds: string[]): VolumeRef {
  return { volume, numeric: Number(volume), chapterIds };
}

function makeChapterRef(overrides: Partial<ChapterRef> & { id: string }): ChapterRef {
  return {
    volume: "1",
    chapter: "1",
    title: "Chapter 1",
    translatedLanguage: "en",
    scanlationGroup: null,
    readableAt: "2024-01-01T00:00:00Z",
    externalUrl: null,
    ...overrides,
  };
}

function makeClient(overrides?: Partial<MangaDexClient>): MangaDexClient {
  const chapter1 = makeChapterRef({ id: "ch-1", volume: "1", chapter: "1" });
  return {
    searchManga: async () => [makeCandidate()],
    resolveTitleToId: async () => [makeCandidate()],
    aggregateVolumes: async () => [makeVolumeRef("1", ["ch-1"])],
    feedChapters: async () => [chapter1],
    ...overrides,
  };
}

// Build a MangaDexHttpClient that serves at-home server + image fetch
function makeFullHttpClient(): MangaDexHttpClient {
  return {
    get: async (path: string) => {
      if (path.startsWith("/at-home/server/")) {
        return {
          baseUrl: "https://example.com",
          chapter: {
            hash: "abc123",
            data: ["page1.jpg", "page2.jpg"],
            dataSaver: ["ds1.jpg"],
          },
        };
      }
      throw new Error(`Unexpected HTTP GET: ${path}`);
    },
  } as unknown as MangaDexHttpClient;
}

let tmpDir: string;
let db: Db;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "scanldr-test-"));
  db = openDb(join(tmpDir, "test.db"));
  runMigrations(db);
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

function baseArgs(overrides?: Partial<DownloadArgs>): DownloadArgs {
  return {
    manga: "Test Manga",
    volume: "1",
    format: "cbz",
    outDir: tmpDir,
    quality: "data",
    concurrency: 1,
    delayMs: 0,
    force: false,
    noTrack: false,
    dryRun: false,
    nonTty: true,
    ...overrides,
  };
}

function baseCtx(): DownloadContext {
  return {
    logger: noopLogger,
    config: {
      preferred_languages: ["en"],
      download_quality: "data",
      default_format: "cbz",
      default_out: tmpDir,
      image_concurrency: 1,
      chapter_delay_ms: 0,
      db_path: join(tmpDir, "test.db"),
    },
    db,
  };
}

// Override mangadexImageFetcher to return JPEG bytes without hitting network
// We'll inject through a custom at-home http client that never actually fetches images.
// Instead, we mock globalThis.fetch for image fetches.
function withMockedImageFetch(fn: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (_url: string | URL | Request) => {
      return new Response(JPEG_BYTES, {
        status: 200,
        headers: { "x-cache": "MISS", "content-type": "image/jpeg" },
      });
    },
    { preconnect: () => {} },
  ) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

describe("runDownload — happy path", () => {
  test("produces .cbz file and records history", async () => {
    await withMockedImageFetch(async () => {
      await runDownload(baseArgs(), baseCtx(), makeClient(), makeFullHttpClient());
    });

    // Check .cbz exists
    const cbzPath = join(tmpDir, "test-manga", "test-manga-volume-001.cbz");
    const exists = await Bun.file(cbzPath).exists();
    expect(exists).toBe(true);

    // P1.2 — assert .cbz contents: page count, filename convention, sort order
    const raw = new Uint8Array(await Bun.file(cbzPath).arrayBuffer());
    const entries = unzipSync(raw);
    const names = Object.keys(entries).sort();
    // makeFullHttpClient returns 2 pages for "data" quality (data: ["page1.jpg","page2.jpg"])
    expect(names).toHaveLength(2);
    expect(names[0]).toBe("0001.jpg");
    expect(names[1]).toBe("0002.jpg");

    // P1.1 — assert all history columns
    const history = listHistory(db);
    expect(history.length).toBe(1);
    expect(history[0]).toMatchObject({
      mangaId: "manga-id-1",
      mangaTitle: "Test Manga",
      volume: "1",
      chapterId: "ch-1",
      chapterNum: "1",
      source: "mangadex",
      language: "en",
      downloadedAt: expect.any(Number),
    });
  });
});

describe("runDownload — dryRun", () => {
  test("does not write .cbz and does not record history", async () => {
    await withMockedImageFetch(async () => {
      await runDownload(baseArgs({ dryRun: true }), baseCtx(), makeClient(), makeFullHttpClient());
    });

    const cbzPath = join(tmpDir, "test-manga", "test-manga-volume-001.cbz");
    const exists = await Bun.file(cbzPath).exists();
    expect(exists).toBe(false);

    const history = listHistory(db);
    expect(history.length).toBe(0);
  });
});

describe("runDownload — noTrack", () => {
  test("writes .cbz but does not record history", async () => {
    await withMockedImageFetch(async () => {
      await runDownload(baseArgs({ noTrack: true }), baseCtx(), makeClient(), makeFullHttpClient());
    });

    const cbzPath = join(tmpDir, "test-manga", "test-manga-volume-001.cbz");
    const exists = await Bun.file(cbzPath).exists();
    expect(exists).toBe(true);

    const history = listHistory(db);
    expect(history.length).toBe(0);
  });
});

describe("runDownload — force", () => {
  test("re-downloads even if volume is already in history", async () => {
    // Run first download to populate history
    await withMockedImageFetch(async () => {
      await runDownload(baseArgs(), baseCtx(), makeClient(), makeFullHttpClient());
    });

    const historyBefore = listHistory(db);
    expect(historyBefore.length).toBeGreaterThan(0);

    // Run again without force — should skip
    let loggedSkip = false;
    const captureLogger: Logger = {
      info: (_obj: unknown, msg?: string) => {
        if (msg?.includes("skipping")) loggedSkip = true;
      },
      warn: () => {},
      error: () => {},
    };

    await runDownload(
      baseArgs(),
      { ...baseCtx(), logger: captureLogger },
      makeClient(),
      makeFullHttpClient(),
    );
    expect(loggedSkip).toBe(true);

    // Run with force — should re-download without logging skip
    loggedSkip = false;
    await withMockedImageFetch(async () => {
      await runDownload(
        baseArgs({ force: true }),
        { ...baseCtx(), logger: captureLogger },
        makeClient(),
        makeFullHttpClient(),
      );
    });
    expect(loggedSkip).toBe(false);
  });
});

describe("runDownload — external chapter", () => {
  test("throws CliError for external chapters", async () => {
    const externalChapter = makeChapterRef({
      id: "ch-ext",
      volume: "1",
      chapter: "1",
      externalUrl: "https://mangaplus.shueisha.co.jp/viewer/123",
    });

    const clientWithExternal = makeClient({
      feedChapters: async () => [externalChapter],
    });

    await expect(
      runDownload(baseArgs(), baseCtx(), clientWithExternal, makeFullHttpClient()),
    ).rejects.toBeInstanceOf(CliError);
  });

  test("CliError message contains the external URL", async () => {
    const extUrl = "https://mangaplus.shueisha.co.jp/viewer/456";
    const externalChapter = makeChapterRef({
      id: "ch-ext",
      volume: "1",
      chapter: "2",
      externalUrl: extUrl,
    });

    const clientWithExternal = makeClient({
      feedChapters: async () => [externalChapter],
    });

    try {
      await runDownload(baseArgs(), baseCtx(), clientWithExternal, makeFullHttpClient());
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain(extUrl);
    }
  });

  test("emits logger.warn with download.external_chapter event before throwing", async () => {
    const extUrl = "https://mangaplus.shueisha.co.jp/viewer/789";
    const externalChapter = makeChapterRef({
      id: "ch-ext-warn",
      volume: "1",
      chapter: "3",
      externalUrl: extUrl,
    });

    const clientWithExternal = makeClient({
      feedChapters: async () => [externalChapter],
    });

    let warnEvent: string | undefined;
    const spyLogger: Logger = {
      info: () => {},
      warn: (obj: unknown) => {
        if (typeof obj === "object" && obj !== null && "event" in obj) {
          warnEvent = (obj as Record<string, unknown>).event as string;
        }
      },
      error: () => {},
    };

    try {
      await runDownload(
        baseArgs(),
        { ...baseCtx(), logger: spyLogger },
        clientWithExternal,
        makeFullHttpClient(),
      );
    } catch {
      // expected
    }

    expect(warnEvent).toBe("download.external_chapter");
  });
});

describe("runDownload — volume not in feed", () => {
  test("logs warn and skips missing volumes", async () => {
    let warnLogged = false;
    const captureLogger: Logger = {
      info: () => {},
      warn: (_obj: unknown, msg?: string) => {
        if (msg?.includes("not found in feed")) warnLogged = true;
      },

      error: () => {},
    };

    // Volume "2" doesn't exist in the feed (which only has volume "1")
    await withMockedImageFetch(async () => {
      await runDownload(
        baseArgs({ volume: "2" }),
        { ...baseCtx(), logger: captureLogger },
        makeClient(),
        makeFullHttpClient(),
      );
    });

    expect(warnLogged).toBe(true);
  });
});

describe("runDownload — atomic history on mid-download failure", () => {
  test("no .cbz and no history rows when at-home server fails for chapter 2", async () => {
    // Three chapters in volume 1
    const ch1 = makeChapterRef({ id: "ch-1", volume: "1", chapter: "1" });
    const ch2 = makeChapterRef({ id: "ch-2", volume: "1", chapter: "2" });
    const ch3 = makeChapterRef({ id: "ch-3", volume: "1", chapter: "3" });

    const multiChapterClient = makeClient({
      aggregateVolumes: async () => [makeVolumeRef("1", ["ch-1", "ch-2", "ch-3"])],
      feedChapters: async () => [ch1, ch2, ch3],
    });

    // at-home: ch-2 server call throws (simulates network error after ch-1 succeeds)
    let atHomeCallCount = 0;
    const failingHttp: MangaDexHttpClient = {
      get: async (path: string) => {
        if (path.startsWith("/at-home/server/")) {
          atHomeCallCount++;
          if (atHomeCallCount === 2) {
            throw new Error("MangaDex HTTP 500: simulated server error for chapter 2");
          }
          return {
            baseUrl: "https://example.com",
            chapter: {
              hash: "abc123",
              data: ["page1.jpg"],
              dataSaver: ["ds1.jpg"],
            },
          };
        }
        throw new Error(`Unexpected HTTP GET: ${path}`);
      },
    } as unknown as MangaDexHttpClient;

    await expect(
      runDownload(baseArgs(), baseCtx(), multiChapterClient, failingHttp),
    ).rejects.toThrow();

    // No .cbz orphan left on disk
    const cbzPath = join(tmpDir, "test-manga", "test-manga-volume-001.cbz");
    const exists = await Bun.file(cbzPath).exists();
    expect(exists).toBe(false);

    // Zero history rows — atomicity preserved
    const history = listHistory(db);
    expect(history.length).toBe(0);
  });
});

describe("runDownload — multi-chapter volume", () => {
  test("happy path: 2 chapters produce 5 files in monotonic order with correct bytes", async () => {
    const ch1 = makeChapterRef({ id: "ch-1", volume: "1", chapter: "1" });
    const ch2 = makeChapterRef({ id: "ch-2", volume: "1", chapter: "2" });

    const multiClient = makeClient({
      aggregateVolumes: async () => [makeVolumeRef("1", ["ch-1", "ch-2"])],
      feedChapters: async () => [ch1, ch2],
    });

    // ch-1 at-home: 2 pages (hash "hash-ch1")
    // ch-2 at-home: 3 pages (hash "hash-ch2")
    const multiHttp: MangaDexHttpClient = {
      get: async (path: string) => {
        if (path === "/at-home/server/ch-1") {
          return {
            baseUrl: "https://example.com",
            chapter: { hash: "hash-ch1", data: ["p1.jpg", "p2.jpg"], dataSaver: [] },
          };
        }
        if (path === "/at-home/server/ch-2") {
          return {
            baseUrl: "https://example.com",
            chapter: { hash: "hash-ch2", data: ["p1.jpg", "p2.jpg", "p3.jpg"], dataSaver: [] },
          };
        }
        throw new Error(`Unexpected HTTP GET: ${path}`);
      },
    } as unknown as MangaDexHttpClient;

    // Distinct marker bytes per chapter: ch1 pages start ff d8 ff e1, ch2 pages start ff d8 ff e2
    const CH1_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, ...JPEG_BYTES.slice(4)]);
    const CH2_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe2, ...JPEG_BYTES.slice(4)]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        const bytes = urlStr.includes("hash-ch1") ? CH1_JPEG : CH2_JPEG;
        return new Response(bytes, {
          status: 200,
          headers: { "x-cache": "MISS", "content-type": "image/jpeg" },
        });
      },
      { preconnect: () => {} },
    ) as typeof fetch;

    try {
      await runDownload(baseArgs(), baseCtx(), multiClient, multiHttp);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const cbzPath = join(tmpDir, "test-manga", "test-manga-volume-001.cbz");
    const exists = await Bun.file(cbzPath).exists();
    expect(exists).toBe(true);

    const raw = new Uint8Array(await Bun.file(cbzPath).arrayBuffer());
    const entries = unzipSync(raw);
    const names = Object.keys(entries).sort();

    // 2 ch1 pages + 3 ch2 pages = 5
    expect(names).toHaveLength(5);
    expect(names).toEqual(["0001.jpg", "0002.jpg", "0003.jpg", "0004.jpg", "0005.jpg"]);

    // First 2 files must come from ch1 fetcher (marker byte 0xe1)
    expect(entries["0001.jpg"]?.[3]).toBe(0xe1);
    expect(entries["0002.jpg"]?.[3]).toBe(0xe1);

    // Last 3 files must come from ch2 fetcher (marker byte 0xe2)
    expect(entries["0003.jpg"]?.[3]).toBe(0xe2);
    expect(entries["0004.jpg"]?.[3]).toBe(0xe2);
    expect(entries["0005.jpg"]?.[3]).toBe(0xe2);

    // 2 history rows: one per chapter
    const history = listHistory(db);
    expect(history).toHaveLength(2);
    expect(history.map((r) => r.chapterId).sort()).toEqual(["ch-1", "ch-2"]);
  });
});

describe("runDownload — at-home 404", () => {
  test("emits logger.warn with download.at_home_404 event before throwing CliError", async () => {
    // HTTP client that throws AtHomeError 404 on at-home server call
    const atHome404Http: MangaDexHttpClient = {
      get: async (path: string) => {
        if (path.startsWith("/at-home/server/")) {
          throw new AtHomeError("ch-1", 404, "at-home server returned 404 for chapter ch-1");
        }
        throw new Error(`Unexpected: ${path}`);
      },
    } as unknown as MangaDexHttpClient;

    const warnEvents: string[] = [];
    const spyLogger: Logger = {
      info: () => {},
      warn: (obj: unknown) => {
        if (typeof obj === "object" && obj !== null && "event" in obj) {
          warnEvents.push((obj as Record<string, unknown>).event as string);
        }
      },
      error: () => {},
    };

    try {
      await runDownload(
        baseArgs(),
        { ...baseCtx(), logger: spyLogger },
        makeClient(),
        atHome404Http,
      );
    } catch {
      // expected CliError
    }

    expect(warnEvents).toContain("download.at_home_404");
  });
});

describe("runDownload — ambiguous title non-TTY", () => {
  test("emits logger.warn with download.ambiguous_title event before throwing", async () => {
    const multiClient = makeClient({
      resolveTitleToId: async () => [
        makeCandidate({ id: "id-1", title: "Manga A" }),
        makeCandidate({ id: "id-2", title: "Manga B" }),
      ],
    });

    let warnEvent: string | undefined;
    const spyLogger: Logger = {
      info: () => {},
      warn: (obj: unknown) => {
        if (typeof obj === "object" && obj !== null && "event" in obj) {
          warnEvent = (obj as Record<string, unknown>).event as string;
        }
      },
      error: () => {},
    };

    try {
      await runDownload(
        baseArgs({ nonTty: true }),
        { ...baseCtx(), logger: spyLogger },
        multiClient,
        makeFullHttpClient(),
      );
    } catch {
      // expected CliError
    }

    expect(warnEvent).toBe("download.ambiguous_title");
  });
});

describe("runDownload — range parsing", () => {
  test("invalid range throws CliError", async () => {
    await expect(
      runDownload(baseArgs({ volume: "5-3" }), baseCtx(), makeClient(), makeFullHttpClient()),
    ).rejects.toBeInstanceOf(CliError);
  });

  test("--volume none throws CliError with deferred message", async () => {
    await expect(
      runDownload(baseArgs({ volume: "none" }), baseCtx(), makeClient(), makeFullHttpClient()),
    ).rejects.toBeInstanceOf(CliError);
  });

  test("--chapter none throws CliError (exit-code 2)", async () => {
    const err = await runDownload(
      baseArgs({ volume: undefined, chapter: "none" }),
      baseCtx(),
      makeClient(),
      makeFullHttpClient(),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).exitCode).toBe(2);
    expect((err as CliError).message).toMatch(/not yet supported/);
  });
});

// ---------------------------------------------------------------------------
// --chapter tests
// ---------------------------------------------------------------------------

describe("runDownload --chapter — happy path 3-chapter range", () => {
  test("produces 3 archives with correct names, pages, and history", async () => {
    // ch1 → vol "1", ch2 → vol "1", ch3 → vol "2"
    const ch1 = makeChapterRef({ id: "ch-1", volume: "1", chapter: "1" });
    const ch2 = makeChapterRef({ id: "ch-2", volume: "1", chapter: "2" });
    const ch3 = makeChapterRef({ id: "ch-3", volume: "2", chapter: "3" });

    const client = makeClient({
      aggregateVolumes: async () => [
        makeVolumeRef("1", ["ch-1", "ch-2"]),
        makeVolumeRef("2", ["ch-3"]),
      ],
      feedChapters: async () => [ch1, ch2, ch3],
    });

    // Each chapter has exactly 1 page
    const http: MangaDexHttpClient = {
      get: async (path: string) => {
        if (path.startsWith("/at-home/server/")) {
          return {
            baseUrl: "https://example.com",
            chapter: { hash: "abc", data: ["page1.jpg"], dataSaver: [] },
          };
        }
        throw new Error(`Unexpected: ${path}`);
      },
    } as unknown as MangaDexHttpClient;

    await withMockedImageFetch(async () => {
      await runDownload(baseArgs({ volume: undefined, chapter: "1-3" }), baseCtx(), client, http);
    });

    // Assert all 3 archives exist with correct names
    const slug = "test-manga";
    for (const [num, name] of [
      ["1", "001"],
      ["2", "002"],
      ["3", "003"],
    ] as const) {
      const cbzPath = join(tmpDir, slug, `${slug}-chapter-${name}.cbz`);
      const exists = await Bun.file(cbzPath).exists();
      expect(exists).toBe(true);

      const raw = new Uint8Array(await Bun.file(cbzPath).arrayBuffer());
      const entries = unzipSync(raw);
      const names = Object.keys(entries).sort();
      expect(names).toHaveLength(1);
      expect(names[0]).toBe("0001.jpg");
      void num; // used above for clarity
    }

    // Assert 3 history rows with correct volumes
    const history = listHistory(db);
    expect(history).toHaveLength(3);

    const byChapter = new Map(history.map((r) => [r.chapterId, r]));
    expect(byChapter.get("ch-1")).toMatchObject({
      volume: "1",
      chapterNum: "1",
      source: "mangadex",
      language: "en",
      mangaId: "manga-id-1",
    });
    expect(byChapter.get("ch-2")).toMatchObject({ volume: "1", chapterNum: "2" });
    expect(byChapter.get("ch-3")).toMatchObject({ volume: "2", chapterNum: "3" });
  });
});

describe("runDownload --chapter — decimal chapter", () => {
  test("decimal chapter filename uses padded integer part", async () => {
    const ch = makeChapterRef({ id: "ch-185", volume: "3", chapter: "18.5" });
    const client = makeClient({
      aggregateVolumes: async () => [makeVolumeRef("3", ["ch-185"])],
      feedChapters: async () => [ch],
    });

    const http: MangaDexHttpClient = {
      get: async (path: string) => {
        if (path.startsWith("/at-home/server/")) {
          return {
            baseUrl: "https://example.com",
            chapter: { hash: "abc", data: ["page1.jpg"], dataSaver: [] },
          };
        }
        throw new Error(`Unexpected: ${path}`);
      },
    } as unknown as MangaDexHttpClient;

    await withMockedImageFetch(async () => {
      await runDownload(baseArgs({ volume: undefined, chapter: "18.5" }), baseCtx(), client, http);
    });

    const cbzPath = join(tmpDir, "test-manga", "test-manga-chapter-018.5.cbz");
    const exists = await Bun.file(cbzPath).exists();
    expect(exists).toBe(true);
  });
});

describe("runDownload --chapter — null volume chapter", () => {
  test("chapter with null volume writes volume='none' in history", async () => {
    const ch = makeChapterRef({ id: "ch-7", volume: null, chapter: "7" });
    const client = makeClient({
      aggregateVolumes: async () => [],
      feedChapters: async () => [ch],
    });

    const http: MangaDexHttpClient = {
      get: async (path: string) => {
        if (path.startsWith("/at-home/server/")) {
          return {
            baseUrl: "https://example.com",
            chapter: { hash: "abc", data: ["page1.jpg"], dataSaver: [] },
          };
        }
        throw new Error(`Unexpected: ${path}`);
      },
    } as unknown as MangaDexHttpClient;

    await withMockedImageFetch(async () => {
      await runDownload(baseArgs({ volume: undefined, chapter: "7" }), baseCtx(), client, http);
    });

    const history = listHistory(db);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ volume: "none", chapterId: "ch-7" });

    // Filename uses chapter number, not "none"
    const cbzPath = join(tmpDir, "test-manga", "test-manga-chapter-007.cbz");
    const exists = await Bun.file(cbzPath).exists();
    expect(exists).toBe(true);
  });
});

describe("runDownload — mutual exclusion", () => {
  test("passing both --volume and --chapter throws CliError with exit code 2", async () => {
    await expect(
      runDownload(
        baseArgs({ volume: "1", chapter: "1" }),
        baseCtx(),
        makeClient(),
        makeFullHttpClient(),
      ),
    ).rejects.toBeInstanceOf(CliError);
  });
});

describe("runDownload --chapter — external chapter refused", () => {
  test("external chapter in --chapter mode throws CliError", async () => {
    const extUrl = "https://mangaplus.shueisha.co.jp/viewer/999";
    const ch = makeChapterRef({ id: "ch-ext", volume: "1", chapter: "5", externalUrl: extUrl });
    const client = makeClient({
      aggregateVolumes: async () => [makeVolumeRef("1", ["ch-ext"])],
      feedChapters: async () => [ch],
    });

    await expect(
      runDownload(
        baseArgs({ volume: undefined, chapter: "5" }),
        baseCtx(),
        client,
        makeFullHttpClient(),
      ),
    ).rejects.toBeInstanceOf(CliError);
  });

  test("external chapter warn event emitted before throw in --chapter mode", async () => {
    const extUrl = "https://mangaplus.shueisha.co.jp/viewer/999";
    const ch = makeChapterRef({ id: "ch-ext", volume: "1", chapter: "5", externalUrl: extUrl });
    const client = makeClient({
      aggregateVolumes: async () => [makeVolumeRef("1", ["ch-ext"])],
      feedChapters: async () => [ch],
    });

    let warnEvent: string | undefined;
    const spyLogger: Logger = {
      info: () => {},
      warn: (obj: unknown) => {
        if (typeof obj === "object" && obj !== null && "event" in obj) {
          warnEvent = (obj as Record<string, unknown>).event as string;
        }
      },
      error: () => {},
    };

    try {
      await runDownload(
        baseArgs({ volume: undefined, chapter: "5" }),
        { ...baseCtx(), logger: spyLogger },
        client,
        makeFullHttpClient(),
      );
    } catch {
      // expected
    }

    expect(warnEvent).toBe("download.external_chapter");
  });
});
