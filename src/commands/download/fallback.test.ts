import { afterAll, describe, expect, mock, test } from "bun:test";
import type { ChapterRef, VolumeRef } from "@integrations/_shared/manga.ts";
import { MissingAuthError } from "@integrations/fallback-http/index.ts";
import type { FallbackHttpClient } from "@integrations/fallback-http/types.ts";
import type { MangakakalotClient } from "@integrations/mangakakalot/client/index.ts";
import { createMangakakalotClient as mkClient } from "@integrations/mangakakalot/client/index.ts";
import { openDb, runMigrations } from "@plugins/db/index.ts";
import { CliError } from "@plugins/errors/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import type { FallbackSiteOption, MangaDexResolveResult } from "./fallback-types.ts";
import {
  buildFallbackBundles,
  isFallbackEligible,
  promptFallbackSite,
  runFallbackDownload,
} from "./fallback.ts";
import type { DownloadArgs } from "./types.ts";

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const SITES: FallbackSiteOption[] = [{ name: "mangakakalot", display: "mangakakalot.gg" }];

function makeChapterRef(overrides: Partial<ChapterRef> & { id: string }): ChapterRef {
  return {
    volume: "1",
    chapter: "1",
    title: null,
    translatedLanguage: "en",
    scanlationGroup: null,
    readableAt: "2024-01-01T00:00:00Z",
    externalUrl: null,
    ...overrides,
  };
}

function makeVolumeRef(volume: string, chapterIds: string[]): VolumeRef {
  return { volume, numeric: Number(volume), chapterIds };
}

function makeResolveResult(overrides?: Partial<MangaDexResolveResult>): MangaDexResolveResult {
  return {
    candidate: { id: "manga-1", title: "Test", originalLanguage: "ja", year: 2020 },
    volumes: [makeVolumeRef("1", ["ch-1"])],
    chaptersInLang: [makeChapterRef({ id: "ch-1" })],
    language: "en",
    ...overrides,
  };
}

function baseArgs(overrides?: Partial<DownloadArgs>): DownloadArgs {
  return {
    manga: "Test Manga",
    volume: "1",
    format: "cbz",
    outDir: "/tmp",
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

// ---------------------------------------------------------------------------
// isFallbackEligible
// ---------------------------------------------------------------------------

describe("isFallbackEligible", () => {
  test("null → title_not_found", () => {
    expect(isFallbackEligible(null)).toEqual({ eligible: true, reason: "title_not_found" });
  });

  test("empty chaptersInLang → no_chapters_in_lang", () => {
    const result = makeResolveResult({ chaptersInLang: [], language: null });
    expect(isFallbackEligible(result)).toEqual({ eligible: true, reason: "no_chapters_in_lang" });
  });

  test("all chapters with externalUrl → all_external", () => {
    const result = makeResolveResult({
      chaptersInLang: [
        makeChapterRef({ id: "ch-1", externalUrl: "https://mangaplus.shueisha.co.jp/viewer/1" }),
        makeChapterRef({ id: "ch-2", externalUrl: "https://mangaplus.shueisha.co.jp/viewer/2" }),
      ],
    });
    expect(isFallbackEligible(result)).toEqual({ eligible: true, reason: "all_external" });
  });

  test("mix of external and normal chapters → not eligible", () => {
    const result = makeResolveResult({
      chaptersInLang: [
        makeChapterRef({ id: "ch-1", externalUrl: null }),
        makeChapterRef({ id: "ch-2", externalUrl: "https://mangaplus.shueisha.co.jp/viewer/2" }),
      ],
    });
    expect(isFallbackEligible(result)).toEqual({ eligible: false, reason: null });
  });

  test("normal chapter (no externalUrl) → not eligible", () => {
    expect(isFallbackEligible(makeResolveResult())).toEqual({ eligible: false, reason: null });
  });
});

// ---------------------------------------------------------------------------
// promptFallbackSite
// ---------------------------------------------------------------------------

describe("promptFallbackSite", () => {
  test("non-TTY throws CliError with auth hint", async () => {
    await expect(promptFallbackSite(SITES, true, noopLogger)).rejects.toBeInstanceOf(CliError);
  });

  test("non-TTY error message mentions auth", async () => {
    try {
      await promptFallbackSite(SITES, true, noopLogger);
    } catch (err) {
      expect((err as CliError).message).toContain("auth");
    }
  });

  test("non-TTY emits logger.warn with download.fallback_non_tty event", async () => {
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
      await promptFallbackSite(SITES, true, spyLogger);
    } catch {
      // expected
    }

    expect(warnEvent).toBe("download.fallback_non_tty");
  });
});

// ---------------------------------------------------------------------------
// buildFallbackBundles — volume mode
// ---------------------------------------------------------------------------

describe("buildFallbackBundles — volume mode", () => {
  test("maps MangaDex volume → chapter numbers → mangakakalot chapters", () => {
    const mangadexVolumes = [makeVolumeRef("3", ["md-ch18", "md-ch19", "md-ch20", "md-ch21"])];
    const mangadexChapters: ChapterRef[] = [
      makeChapterRef({ id: "md-ch18", chapter: "18", volume: "3" }),
      makeChapterRef({ id: "md-ch19", chapter: "19", volume: "3" }),
      makeChapterRef({ id: "md-ch20", chapter: "20", volume: "3" }),
      makeChapterRef({ id: "md-ch21", chapter: "21", volume: "3" }),
    ];
    const mkChapters: ChapterRef[] = [
      makeChapterRef({ id: "mk-18", chapter: "18", volume: null }),
      makeChapterRef({ id: "mk-19", chapter: "19", volume: null }),
      makeChapterRef({ id: "mk-20", chapter: "20", volume: null }),
      makeChapterRef({ id: "mk-21", chapter: "21", volume: null }),
    ];

    const bundles = buildFallbackBundles({
      args: baseArgs({ volume: "3" }),
      requestedTokens: new Set(["3"]),
      mangadexVolumes,
      mangadexChapters,
      mkChapters,
      logger: noopLogger,
    });

    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.kind).toBe("volume");
    expect(bundles[0]?.bundleNumber).toBe("3");
    expect(bundles[0]?.chapters.map((c) => c.id).sort()).toEqual([
      "mk-18",
      "mk-19",
      "mk-20",
      "mk-21",
    ]);
  });

  test("warns and skips chapters missing from fallback site", () => {
    const mangadexVolumes = [makeVolumeRef("1", ["md-ch1", "md-ch2"])];
    const mangadexChapters: ChapterRef[] = [
      makeChapterRef({ id: "md-ch1", chapter: "1", volume: "1" }),
      makeChapterRef({ id: "md-ch2", chapter: "2", volume: "1" }),
    ];
    // mangakakalot only has ch1
    const mkChapters: ChapterRef[] = [makeChapterRef({ id: "mk-1", chapter: "1", volume: null })];

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

    const bundles = buildFallbackBundles({
      args: baseArgs({ volume: "1" }),
      requestedTokens: new Set(["1"]),
      mangadexVolumes,
      mangadexChapters,
      mkChapters,
      logger: spyLogger,
    });

    // bundle still produced with only available chapters
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.chapters).toHaveLength(1);
    expect(warnEvents).toContain("download.fallback_chapters_missing");
  });

  test("skips volume entirely when MangaDex has no record of it", () => {
    const bundles = buildFallbackBundles({
      args: baseArgs({ volume: "99" }),
      requestedTokens: new Set(["99"]),
      mangadexVolumes: [],
      mangadexChapters: [],
      mkChapters: [makeChapterRef({ id: "mk-1", chapter: "1", volume: null })],
      logger: noopLogger,
    });
    expect(bundles).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildFallbackBundles — chapter mode
// ---------------------------------------------------------------------------

describe("buildFallbackBundles — chapter mode", () => {
  test("maps requested chapter token directly to mangakakalot chapter", () => {
    const mkChapters: ChapterRef[] = [makeChapterRef({ id: "mk-5", chapter: "5", volume: null })];

    const bundles = buildFallbackBundles({
      args: baseArgs({ volume: undefined, chapter: "5" }),
      requestedTokens: new Set(["5"]),
      mangadexVolumes: [],
      mangadexChapters: [],
      mkChapters,
      logger: noopLogger,
    });

    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.kind).toBe("chapter");
    expect(bundles[0]?.chapters[0]?.id).toBe("mk-5");
    // no MangaDex data → "none"
    expect(bundles[0]?.volumeForHistory).toBe("none");
  });

  test("uses MangaDex volume as volumeForHistory when available", () => {
    const mangadexChapters: ChapterRef[] = [
      makeChapterRef({ id: "md-ch5", chapter: "5", volume: "2" }),
    ];
    const mkChapters: ChapterRef[] = [makeChapterRef({ id: "mk-5", chapter: "5", volume: null })];

    const bundles = buildFallbackBundles({
      args: baseArgs({ volume: undefined, chapter: "5" }),
      requestedTokens: new Set(["5"]),
      mangadexVolumes: [],
      mangadexChapters,
      mkChapters,
      logger: noopLogger,
    });

    expect(bundles[0]?.volumeForHistory).toBe("2");
  });

  test("warns and skips chapter when not found on fallback site", () => {
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

    const bundles = buildFallbackBundles({
      args: baseArgs({ volume: undefined, chapter: "99" }),
      requestedTokens: new Set(["99"]),
      mangadexVolumes: [],
      mangadexChapters: [],
      mkChapters: [],
      logger: spyLogger,
    });

    expect(bundles).toHaveLength(0);
    expect(warnEvents).toContain("download.fallback_chapter_missing");
  });
});

// ---------------------------------------------------------------------------
// buildFallbackBundles — total-zero-match path (P2 #1)
// ---------------------------------------------------------------------------

describe("buildFallbackBundles — total zero match for volume", () => {
  test("returns [] and warns for each missing chapter when mangakakalot has none of the MangaDex chapters", () => {
    const mangadexVolumes = [makeVolumeRef("3", ["md-ch18", "md-ch19", "md-ch20", "md-ch21"])];
    const mangadexChapters: ChapterRef[] = [
      makeChapterRef({ id: "md-ch18", chapter: "18", volume: "3" }),
      makeChapterRef({ id: "md-ch19", chapter: "19", volume: "3" }),
      makeChapterRef({ id: "md-ch20", chapter: "20", volume: "3" }),
      makeChapterRef({ id: "md-ch21", chapter: "21", volume: "3" }),
    ];
    // mangakakalot has NONE of ch18-21
    const mkChapters: ChapterRef[] = [makeChapterRef({ id: "mk-99", chapter: "99", volume: null })];

    const warnEvents: Array<{ event: string; missing?: unknown }> = [];
    const spyLogger: Logger = {
      info: () => {},
      warn: (obj: unknown) => {
        if (typeof obj === "object" && obj !== null && "event" in obj) {
          const o = obj as Record<string, unknown>;
          warnEvents.push({ event: o.event as string, missing: o.missing });
        }
      },
      error: () => {},
    };

    const bundles = buildFallbackBundles({
      args: baseArgs({ volume: "3" }),
      requestedTokens: new Set(["3"]),
      mangadexVolumes,
      mangadexChapters,
      mkChapters,
      logger: spyLogger,
    });

    expect(bundles).toHaveLength(0);
    // The warn fires once with all missing chapters listed (partial-match path)
    const missingWarn = warnEvents.find((e) => e.event === "download.fallback_chapters_missing");
    expect(missingWarn).toBeDefined();
    expect(missingWarn?.missing).toEqual(expect.arrayContaining(["18", "19", "20", "21"]));
  });
});

// ---------------------------------------------------------------------------
// runFallbackDownload — MissingAuthError propagation (P2 #2)
// ---------------------------------------------------------------------------

describe("runFallbackDownload — MissingAuthError propagates unwrapped", () => {
  test("MissingAuthError from createFallbackHttp is not wrapped as CliError", async () => {
    const db = openDb(":memory:");
    runMigrations(db);

    const authError = new MissingAuthError("/nonexistent/auth.json");

    const err = await runFallbackDownload({
      args: {
        manga: "Test",
        volume: undefined,
        chapter: "1",
        format: "cbz",
        outDir: "/tmp",
        quality: "data",
        concurrency: 1,
        delayMs: 0,
        force: false,
        noTrack: false,
        dryRun: false,
        nonTty: false,
      },
      ctx: {
        logger: noopLogger,
        config: {
          preferred_languages: ["en"],
          download_quality: "data",
          default_format: "cbz",
          default_out: "/tmp",
          image_concurrency: 1,
          chapter_delay_ms: 0,
          db_path: ":memory:",
        },
        db,
      },
      mangadexResolve: null,
      createFallbackHttp: async () => {
        throw authError;
      },
      createMangakakalotClient: () => {
        throw new Error("should not be called");
      },
      // biome-ignore lint/style/noNonNullAssertion: test stub
      promptSite: async (sites) => sites[0]!,
    }).catch((e) => e);

    db.close();

    expect(err).toBeInstanceOf(MissingAuthError);
    expect(err).not.toBeInstanceOf(CliError);
  });
});

// ---------------------------------------------------------------------------
// runFallbackDownload — search returns zero results (P3 #2)
// ---------------------------------------------------------------------------

describe("runFallbackDownload — searchManga returns empty", () => {
  test("throws CliError with title not found message when search returns []", async () => {
    const db = openDb(":memory:");
    runMigrations(db);

    const fakeFallbackHttp: FallbackHttpClient = {
      get: async () => new Response(new Uint8Array([]), { status: 200 }),
    };

    const mkClientNoResults: MangakakalotClient = {
      searchManga: async () => [],
      getChapterList: async () => [],
      getChapterImages: async () => [],
    };

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

    const err = await runFallbackDownload({
      args: {
        manga: "Nonexistent Manga",
        volume: undefined,
        chapter: "1",
        format: "cbz",
        outDir: "/tmp",
        quality: "data",
        concurrency: 1,
        delayMs: 0,
        force: false,
        noTrack: false,
        dryRun: false,
        nonTty: false,
      },
      ctx: {
        logger: spyLogger,
        config: {
          preferred_languages: ["en"],
          download_quality: "data",
          default_format: "cbz",
          default_out: "/tmp",
          image_concurrency: 1,
          chapter_delay_ms: 0,
          db_path: ":memory:",
        },
        db,
      },
      mangadexResolve: null,
      createFallbackHttp: async () => fakeFallbackHttp,
      createMangakakalotClient: () => mkClientNoResults,
      // biome-ignore lint/style/noNonNullAssertion: test stub
      promptSite: async (sites) => sites[0]!,
    }).catch((e) => e);

    db.close();

    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toContain("Nonexistent Manga");
    expect(warnEvents).toContain("download.fallback_not_found");
  });
});

// ---------------------------------------------------------------------------
// promptFallbackSite — TTY readline mock (P3 #3)
// ---------------------------------------------------------------------------

describe("promptFallbackSite — TTY readline mock", () => {
  afterAll(() => mock.restore());

  test("valid input '1' returns the single site", async () => {
    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (event: string, cb: (line: string) => void) => {
          if (event === "line") cb("1");
        },
        close: () => {},
      }),
    }));

    const result = await promptFallbackSite(SITES, false, noopLogger);
    // biome-ignore lint/style/noNonNullAssertion: SITES[0] always defined
    expect(result).toEqual(SITES[0]!);
  });

  test("out-of-range input '99' → throws CliError", async () => {
    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (event: string, cb: (line: string) => void) => {
          if (event === "line") cb("99");
        },
        close: () => {},
      }),
    }));

    await expect(promptFallbackSite(SITES, false, noopLogger)).rejects.toBeInstanceOf(CliError);
  });

  test("non-numeric input 'abc' → throws CliError", async () => {
    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (event: string, cb: (line: string) => void) => {
          if (event === "line") cb("abc");
        },
        close: () => {},
      }),
    }));

    await expect(promptFallbackSite(SITES, false, noopLogger)).rejects.toBeInstanceOf(CliError);
  });
});

// ---------------------------------------------------------------------------
// makeMangakakalotFetcher — Referer header
// ---------------------------------------------------------------------------

describe("makeMangakakalotFetcher sends Referer header", () => {
  test("image fetch passes referer: https://www.mangakakalot.gg/ to http.get", async () => {
    // Access the fetcher indirectly via runFallbackDownload by observing http.get calls.
    // We capture the headers passed to http.get for the image URL.
    let capturedHeaders: Record<string, string> | undefined;

    const imageUrl = "https://img-r1.2xstorage.com/dandadan/1/0.webp";
    const searchHtml = `<html><body>
      <div class="panel_story_list">
        <div class="story_item">
          <div class="story_name"><a href="https://www.mangakakalot.gg/manga/test-manga">Test Manga</a></div>
        </div>
      </div>
    </body></html>`;
    const chapterHtml = `<div class="container-chapter-reader"><img src="${imageUrl}" /></div>`;
    const chaptersJson = JSON.stringify({
      success: true,
      data: {
        chapters: [
          {
            chapter_name: "Chapter 1",
            chapter_slug: "chapter-1",
            chapter_num: 1,
            updated_at: "2024-01-01T00:00:00.000000Z",
            view: 0,
          },
        ],
      },
    });

    const mockHttp: FallbackHttpClient = {
      get: mock(async (url: string, headers?: Record<string, string>) => {
        if (url === imageUrl) {
          capturedHeaders = headers;
          return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
        }
        if (url.includes("/api/manga/")) {
          return new Response(chaptersJson, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/search/")) {
          return new Response(searchHtml, {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        // Chapter reader
        return new Response(chapterHtml, { status: 200, headers: { "content-type": "text/html" } });
      }),
    };

    const db = openDb(":memory:");
    runMigrations(db);

    await runFallbackDownload({
      args: baseArgs({ volume: undefined, chapter: "1", noTrack: true, dryRun: false }),
      ctx: {
        logger: noopLogger,
        config: {
          preferred_languages: ["en"],
          download_quality: "data",
          default_format: "cbz",
          default_out: "/tmp",
          image_concurrency: 1,
          chapter_delay_ms: 0,
          db_path: ":memory:",
        },
        db,
      },
      mangadexResolve: null,
      createFallbackHttp: async () => mockHttp,
      createMangakakalotClient: (opts) => mkClient(opts),
      promptSite: async (sites) => {
        const site = sites[0];
        if (!site) throw new Error("no sites");
        return site;
      },
    });

    expect(capturedHeaders?.referer).toBe("https://www.mangakakalot.gg/");
  });
});
