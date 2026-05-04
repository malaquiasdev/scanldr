import { describe, expect, test } from "bun:test";
import type { ChapterRef, VolumeRef } from "@integrations/_shared/manga.ts";
import { CliError } from "@plugins/errors/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import type { FallbackSiteOption, MangaDexResolveResult } from "./fallback-types.ts";
import { buildFallbackBundles, isFallbackEligible, promptFallbackSite } from "./fallback.ts";
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
