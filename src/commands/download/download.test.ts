import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FallbackHttpClient } from "@integrations/fallback-http/types.ts";
import { AtHomeError } from "@integrations/mangadex/at-home/index.ts";
import type { MangaDexClient } from "@integrations/mangadex/client/index.ts";
import { TitleNotFoundError } from "@integrations/mangadex/client/index.ts";
import type { ChapterRef, MangaCandidate, VolumeRef } from "@integrations/mangadex/client/index.ts";
import type { MangaDexHttpClient } from "@integrations/mangadex/http/index.ts";
import type { MangakakalotClient } from "@integrations/mangakakalot/client/index.ts";
import type { ImageRef } from "@modules/downloader/types.ts";
import { listHistory } from "@modules/history/index.ts";
import { openDb, runMigrations } from "@plugins/db/index.ts";
import type { Db } from "@plugins/db/index.ts";
import { CliError } from "@plugins/errors/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import { unzipSync } from "fflate";
import type { MangaDexResolveResult } from "./fallback-types.ts";
import { runFallbackDownload } from "./fallback.ts";
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
    packReplace: false,
    packOverwrite: false,
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
  // When ALL chapters in the chosen language are external, runDownload now routes to the
  // fallback path (reason: all_external) per ADR-002. In non-TTY mode the fallback prompt
  // throws a CliError pointing at interactive use + auth setup.

  test("throws CliError when all chapters are external (non-TTY)", async () => {
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

  test("CliError from fallback non-TTY path mentions auth", async () => {
    const externalChapter = makeChapterRef({
      id: "ch-ext",
      volume: "1",
      chapter: "2",
      externalUrl: "https://mangaplus.shueisha.co.jp/viewer/456",
    });

    const clientWithExternal = makeClient({
      feedChapters: async () => [externalChapter],
    });

    try {
      await runDownload(baseArgs(), baseCtx(), clientWithExternal, makeFullHttpClient());
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      // Now routes via fallback path → non-TTY → "auth" hint in message
      expect((err as CliError).message).toContain("auth");
    }
  });

  test("emits fallback_triggered event when all chapters are external", async () => {
    const externalChapter = makeChapterRef({
      id: "ch-ext-warn",
      volume: "1",
      chapter: "3",
      externalUrl: "https://mangaplus.shueisha.co.jp/viewer/789",
    });

    const clientWithExternal = makeClient({
      feedChapters: async () => [externalChapter],
    });

    let triggeredEvent: string | undefined;
    const spyLogger: Logger = {
      info: (obj: unknown) => {
        if (typeof obj === "object" && obj !== null && "event" in obj) {
          const e = (obj as Record<string, unknown>).event as string;
          if (e === "download.fallback_triggered") triggeredEvent = e;
        }
      },
      warn: () => {},
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

    expect(triggeredEvent).toBe("download.fallback_triggered");
  });

  test("mixed external+normal chapters still refuse via processBundle external check", async () => {
    // Only ONE chapter is external, another is normal — not all_external → MangaDex path
    // → processBundle sees the external chapter and throws with the URL in the message
    const normalCh = makeChapterRef({ id: "ch-ok", volume: "1", chapter: "1" });
    const externalCh = makeChapterRef({
      id: "ch-ext",
      volume: "1",
      chapter: "2",
      externalUrl: "https://mangaplus.shueisha.co.jp/viewer/999",
    });

    const clientMixed = makeClient({
      feedChapters: async () => [normalCh, externalCh],
    });

    // Request vol 1 which includes both — processBundle will hit ch-ok first (fine)
    // then ch-ext → throws with external URL
    // Actually volumes are filtered per chapter, so both chapters are in vol 1
    let errorMsg = "";
    try {
      await withMockedImageFetch(async () => {
        await runDownload(baseArgs(), baseCtx(), clientMixed, makeFullHttpClient());
      });
    } catch (err) {
      errorMsg = (err as Error).message;
    }

    // processBundle external check fires
    expect(errorMsg).toContain("mangaplus.shueisha.co.jp");
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

describe("runDownload — partial chapter failure continues (AC#10)", () => {
  test("5 chapters requested, 2 fail: resolves, 3 cbz files exist, no packed cbz, warn logged", async () => {
    // Use --chapter mode with 5 chapters so pack would normally be triggered
    const chapters = [1, 2, 3, 4, 5].map((n) =>
      makeChapterRef({ id: `ch-${n}`, volume: "1", chapter: String(n) }),
    );

    const multiChapterClient = makeClient({
      aggregateVolumes: async () => [
        makeVolumeRef(
          "1",
          chapters.map((c) => c.id),
        ),
      ],
      feedChapters: async () => chapters,
    });

    // ch-2 and ch-4 fail (their at-home server calls throw)
    const failingHttp: MangaDexHttpClient = {
      get: async (path: string) => {
        if (path.startsWith("/at-home/server/")) {
          const chId = path.replace("/at-home/server/", "");
          if (chId === "ch-2" || chId === "ch-4") {
            throw new Error(`simulated server error for ${chId}`);
          }
          return {
            baseUrl: "https://example.com",
            chapter: { hash: "abc123", data: ["page1.jpg"], dataSaver: ["ds1.jpg"] },
          };
        }
        throw new Error(`Unexpected HTTP GET: ${path}`);
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

    // Should resolve, not throw
    await withMockedImageFetch(async () => {
      await runDownload(
        baseArgs({ volume: undefined, chapter: "1-5", pack: true, nonTty: true }),
        { ...baseCtx(), logger: spyLogger },
        multiChapterClient,
        failingHttp,
      );
    });

    // 3 individual chapter cbz files should exist (ch-1, ch-3, ch-5)
    const slug = "test-manga";
    for (const [, padded] of [
      ["1", "001"],
      ["3", "003"],
      ["5", "005"],
    ] as const) {
      const p = join(tmpDir, slug, `${slug}-chapter-${padded}.cbz`);
      expect(await Bun.file(p).exists()).toBe(true);
    }
    // ch-2 and ch-4 should NOT exist
    for (const padded of ["002", "004"] as const) {
      const p = join(tmpDir, slug, `${slug}-chapter-${padded}.cbz`);
      expect(await Bun.file(p).exists()).toBe(false);
    }

    // No packed volume cbz
    const files = await import("node:fs/promises").then((m) =>
      m.readdir(join(tmpDir, slug)).catch(() => [] as string[]),
    );
    const packedFile = files.find((f) => f.startsWith(`${slug}-volume-`) && f.endsWith(".cbz"));
    expect(packedFile).toBeUndefined();

    // pack.skipped warn must have fired
    expect(warnEvents).toContain("pack.skipped");
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
    for (const [, name] of [
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

describe("runDownload --chapter — duplicate upload tiebreak", () => {
  test("latest readableAt wins when two uploads share the same chapter number", async () => {
    // older upload — should be discarded
    const older = makeChapterRef({
      id: "ch-old",
      volume: "1",
      chapter: "1",
      readableAt: "2023-01-01T00:00:00Z",
    });
    // newer upload — should win
    const newer = makeChapterRef({
      id: "ch-new",
      volume: "1",
      chapter: "1",
      readableAt: "2024-06-01T00:00:00Z",
    });

    const client = makeClient({
      aggregateVolumes: async () => [makeVolumeRef("1", ["ch-old", "ch-new"])],
      // Feed returns older first to verify feed-order independence
      feedChapters: async () => [older, newer],
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
      await runDownload(baseArgs({ volume: undefined, chapter: "1" }), baseCtx(), client, http);
    });

    // Only one bundle should be recorded, and it must be the newer upload
    const history = listHistory(db);
    expect(history).toHaveLength(1);
    expect(history[0]?.chapterId).toBe("ch-new");
  });

  test("chapter with null chapter number is excluded from --chapter lookup", async () => {
    const nullCh = makeChapterRef({ id: "ch-null", volume: "1", chapter: null });
    // Also include a real chapter to confirm the feed is processed normally
    const realCh = makeChapterRef({ id: "ch-real", volume: "1", chapter: "2" });

    const client = makeClient({
      aggregateVolumes: async () => [makeVolumeRef("1", ["ch-null", "ch-real"])],
      feedChapters: async () => [nullCh, realCh],
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
      // --chapter 2 should match realCh, null-chapter entry must not interfere
      await runDownload(baseArgs({ volume: undefined, chapter: "2" }), baseCtx(), client, http);
    });

    const history = listHistory(db);
    // Only the real chapter should be recorded; null-chapter entry is excluded from lookup
    expect(history).toHaveLength(1);
    expect(history[0]?.chapterId).toBe("ch-real");
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

describe("runDownload --chapter — external chapter routes to fallback", () => {
  // When all chapters in feed are external (in --chapter mode the feed still has externalUrl set),
  // isFallbackEligible returns all_external and we route to fallback.
  test("external chapter in --chapter mode throws CliError (via fallback non-TTY)", async () => {
    const extUrl = "https://mangaplus.shueisha.co.jp/viewer/999";
    const ch = makeChapterRef({ id: "ch-ext", volume: "1", chapter: "5", externalUrl: extUrl });
    const client = makeClient({
      aggregateVolumes: async () => [makeVolumeRef("1", ["ch-ext"])],
      feedChapters: async () => [ch],
    });

    // All chapters are external → fallback → non-TTY → CliError
    await expect(
      runDownload(
        baseArgs({ volume: undefined, chapter: "5" }),
        baseCtx(),
        client,
        makeFullHttpClient(),
      ),
    ).rejects.toBeInstanceOf(CliError);
  });

  test("fallback_triggered event emitted in --chapter mode when all external", async () => {
    const extUrl = "https://mangaplus.shueisha.co.jp/viewer/999";
    const ch = makeChapterRef({ id: "ch-ext", volume: "1", chapter: "5", externalUrl: extUrl });
    const client = makeClient({
      aggregateVolumes: async () => [makeVolumeRef("1", ["ch-ext"])],
      feedChapters: async () => [ch],
    });

    let triggeredEvent: string | undefined;
    const spyLogger: Logger = {
      info: (obj: unknown) => {
        if (typeof obj === "object" && obj !== null && "event" in obj) {
          const e = (obj as Record<string, unknown>).event as string;
          if (e === "download.fallback_triggered") triggeredEvent = e;
        }
      },
      warn: () => {},
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

    expect(triggeredEvent).toBe("download.fallback_triggered");
  });
});

// ---------------------------------------------------------------------------
// Fallback integration helpers
// ---------------------------------------------------------------------------

/** Minimal 1×1 PNG bytes — distinct from JPEG_BYTES so we can assert source */
const MK_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

function makeMkChapterRef(overrides: Partial<ChapterRef> & { id: string }): ChapterRef {
  return {
    volume: null,
    chapter: "1",
    title: null,
    translatedLanguage: "en",
    scanlationGroup: null,
    readableAt: "2024-01-01T00:00:00Z",
    externalUrl: null,
    ...overrides,
  };
}

function makeFallbackHttp(): FallbackHttpClient {
  return {
    get: async (_url: string) =>
      new Response(MK_PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
  };
}

function makeMkClient(overrides?: Partial<MangakakalotClient>): MangakakalotClient {
  const ch1 = makeMkChapterRef({ id: "mk-ch-1", chapter: "1" });
  return {
    searchManga: async () => [
      { id: "dandadan", title: "Dandadan", originalLanguage: "ja", year: 2021 },
    ],
    getChapterList: async () => [ch1],
    getChapterImages: async (_id: string): Promise<ImageRef[]> => [
      { url: "https://cdn.mangakakalot.gg/img/1.png", page: 1 },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fallback integration tests
// ---------------------------------------------------------------------------

describe("fallback — title not on MangaDex, mangakakalot has it", () => {
  test("produces .cbz and records history with source=mangakakalot", async () => {
    const ch1 = makeMkChapterRef({ id: "mk-ch-1", chapter: "1" });
    const mkClient: MangakakalotClient = {
      searchManga: async () => [
        { id: "dandadan", title: "Dandadan", originalLanguage: "ja", year: 2021 },
      ],
      getChapterList: async () => [ch1],
      getChapterImages: async (_id: string): Promise<ImageRef[]> => [
        { url: "https://cdn.mk.gg/img/1.png", page: 1 },
      ],
    };

    const fallbackHttp = makeFallbackHttp();

    await runFallbackDownload({
      args: baseArgs({ manga: "Dandadan", volume: undefined, chapter: "1" }),
      ctx: baseCtx(),
      mangadexResolve: null,
      createFallbackHttp: async () => fallbackHttp,
      createMangakakalotClient: () => mkClient,
      // biome-ignore lint/style/noNonNullAssertion: test stub — sites always has 1 entry
      promptSite: async (sites) => sites[0]!,
    });

    const cbzPath = join(tmpDir, "dandadan", "dandadan-chapter-001.cbz");
    expect(await Bun.file(cbzPath).exists()).toBe(true);

    // Verify the .cbz contents came from mangakakalot (MK_PNG_BYTES sentinel)
    const raw = await Bun.file(cbzPath).arrayBuffer();
    const entries = unzipSync(new Uint8Array(raw));
    const entryNames = Object.keys(entries);
    expect(entryNames).toHaveLength(1);
    // Filename follows zero-pad pattern 0001.<ext>
    expect(entryNames[0]).toMatch(/^0001\.\w+$/);
    // Bytes match the sentinel MK_PNG_BYTES from the mock fetcher
    expect(entries[entryNames[0] as string]).toEqual(MK_PNG_BYTES);

    const history = listHistory(db);
    expect(history.length).toBe(1);
    expect(history[0]).toMatchObject({
      mangaId: "dandadan",
      mangaTitle: "Dandadan",
      chapterId: "mk-ch-1",
      chapterNum: "1",
      source: "mangakakalot",
      language: "en",
    });
  });
});

describe("fallback — MangaDex aggregate reused for volume mode", () => {
  test("vol3 = ch18-21 from MangaDex maps to mangakakalot ch18-21, one archive produced", async () => {
    const mangadexResolve: MangaDexResolveResult = {
      candidate: {
        id: "md-manga-id",
        title: "Witch Hat Atelier",
        originalLanguage: "ja",
        year: 2016,
      },
      volumes: [{ volume: "3", numeric: 3, chapterIds: ["md-18", "md-19", "md-20", "md-21"] }],
      chaptersInLang: [
        makeMkChapterRef({ id: "md-18", chapter: "18", translatedLanguage: "en" }),
        makeMkChapterRef({ id: "md-19", chapter: "19", translatedLanguage: "en" }),
        makeMkChapterRef({ id: "md-20", chapter: "20", translatedLanguage: "en" }),
        makeMkChapterRef({ id: "md-21", chapter: "21", translatedLanguage: "en" }),
      ],
      language: null,
    };

    const mkClient: MangakakalotClient = {
      searchManga: async () => [
        { id: "witch-hat", title: "Witch Hat Atelier", originalLanguage: "ja", year: 2016 },
      ],
      getChapterList: async () => [
        makeMkChapterRef({ id: "mk-18", chapter: "18" }),
        makeMkChapterRef({ id: "mk-19", chapter: "19" }),
        makeMkChapterRef({ id: "mk-20", chapter: "20" }),
        makeMkChapterRef({ id: "mk-21", chapter: "21" }),
      ],
      getChapterImages: async (_id: string): Promise<ImageRef[]> => [
        { url: "https://cdn.mk.gg/img/1.png", page: 1 },
      ],
    };

    const fallbackHttp = makeFallbackHttp();

    await runFallbackDownload({
      args: baseArgs({ manga: "Witch Hat Atelier", volume: "3" }),
      ctx: baseCtx(),
      mangadexResolve,
      createFallbackHttp: async () => fallbackHttp,
      createMangakakalotClient: () => mkClient,
      // biome-ignore lint/style/noNonNullAssertion: test stub — sites always has 1 entry
      promptSite: async (sites) => sites[0]!,
    });

    const cbzPath = join(tmpDir, "witch-hat-atelier", "witch-hat-atelier-volume-003.cbz");
    expect(await Bun.file(cbzPath).exists()).toBe(true);

    const history = listHistory(db);
    expect(history.length).toBe(4);
    expect(history.every((r) => r.source === "mangakakalot")).toBe(true);
    expect(history.every((r) => r.volume === "3")).toBe(true);
  });
});

describe("fallback — all MangaDex chapters external (Dandadan/MangaPlus scenario)", () => {
  test("triggers fallback with reason=all_external, non-TTY → CliError with auth hint", async () => {
    const externalCh = makeChapterRef({
      id: "ch-ext",
      volume: "1",
      chapter: "1",
      externalUrl: "https://mangaplus.shueisha.co.jp/viewer/1",
    });

    const clientAllExternal = makeClient({ feedChapters: async () => [externalCh] });

    let fallbackReason: string | undefined;
    const spyLogger: Logger = {
      info: (obj: unknown) => {
        if (typeof obj === "object" && obj !== null && "event" in obj) {
          const o = obj as Record<string, unknown>;
          if (o.event === "download.fallback_triggered") {
            fallbackReason = o.reason as string;
          }
        }
      },
      warn: () => {},
      error: () => {},
    };

    const err = await runDownload(
      baseArgs({ nonTty: true }),
      { ...baseCtx(), logger: spyLogger },
      clientAllExternal,
      makeFullHttpClient(),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toContain("auth");
    expect(fallbackReason).toBe("all_external");
  });
});

describe("fallback — non-TTY with title_not_found → CliError", () => {
  test("throws CliError pointing at auth and interactive use (--chapter mode)", async () => {
    const clientNoResults = makeClient({
      resolveTitleToId: async () => {
        throw new TitleNotFoundError("Nonexistent");
      },
    });

    // --volume with no MangaDex aggregate → hits "--chapter" error before "auth" error
    // Use --chapter to reach the site-picker prompt which requires TTY
    const err = await runDownload(
      baseArgs({ nonTty: true, volume: undefined, chapter: "1" }),
      baseCtx(),
      clientNoResults,
      makeFullHttpClient(),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toContain("auth");
  });

  test("throws CliError with --chapter hint when title_not_found in --volume mode", async () => {
    const clientNoResults = makeClient({
      resolveTitleToId: async () => {
        throw new TitleNotFoundError("Nonexistent");
      },
    });

    // --volume mode + no MangaDex resolve → volume metadata check fires first
    const err = await runDownload(
      baseArgs({ nonTty: true, volume: "1" }),
      baseCtx(),
      clientNoResults,
      makeFullHttpClient(),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toContain("--chapter");
  });
});

describe("fallback — volume mode without MangaDex aggregate", () => {
  test("mangadexResolve null + volume → CliError with --chapter hint", async () => {
    const fallbackHttp = makeFallbackHttp();
    const mkClient = makeMkClient();

    const err = await runFallbackDownload({
      args: baseArgs({ volume: "1" }),
      ctx: baseCtx(),
      mangadexResolve: null,
      createFallbackHttp: async () => fallbackHttp,
      createMangakakalotClient: () => mkClient,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toContain("--chapter");
  });

  test("mangadexResolve with empty volumes + volume mode → CliError with --chapter hint", async () => {
    const fallbackHttp = makeFallbackHttp();
    const mkClient = makeMkClient();

    const resolve: MangaDexResolveResult = {
      candidate: { id: "md-id", title: "Test", originalLanguage: "ja", year: 2020 },
      volumes: [],
      chaptersInLang: [],
      language: null,
    };

    const err = await runFallbackDownload({
      args: baseArgs({ volume: "1" }),
      ctx: baseCtx(),
      mangadexResolve: resolve,
      createFallbackHttp: async () => fallbackHttp,
      createMangakakalotClient: () => mkClient,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toContain("--chapter");
  });
});
