// Fallback download path — entered when MangaDex is unavailable for a title.
// Handles site-picker prompt, mangakakalot client bootstrap, bundle construction,
// image fetching, and history recording.

import type { ChapterRef, VolumeRef } from "@integrations/_shared/manga.ts";
import type { FallbackHttpClient } from "@integrations/fallback-http/types.ts";
import {
  MangakakalotParseError,
} from "@integrations/mangakakalot/client/index.ts";
import type {
  VolumeMap,
  createMangakakalotClient,
} from "@integrations/mangakakalot/client/index.ts";
import { downloadBundle } from "@modules/downloader/index.ts";
import type { ChapterInput, ImageRef } from "@modules/downloader/types.ts";
import { isVolumeFullyDownloaded, recordDownloadedChapters } from "@modules/history/index.ts";
import type { DownloadRow } from "@modules/history/index.ts";
import { CliError } from "@plugins/errors/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import type {
  FallbackBundle,
  FallbackSiteOption,
  MangaDexResolveResult,
} from "./fallback-types.ts";
import { runPackFlow } from "./pack-flow.ts";
import type { PackedChapter } from "./pack.ts";
import { promptNumericChoice } from "./prompt.ts";
import { parseRangeSet } from "./range.ts";
import { toSlug } from "./slug.ts";
import type { DownloadArgs, DownloadContext } from "./types.ts";

export type {
  FallbackBundle,
  FallbackSiteOption,
  MangaDexResolveResult,
} from "./fallback-types.ts";

// mangakakalot is EN-only by design (ADR-002 per-site strategy).
// History rows from this source always carry language: "en".
const MANGAKAKALOT_LANGUAGE = "en";

// ---------------------------------------------------------------------------
// isFallbackEligible
// ---------------------------------------------------------------------------

export function isFallbackEligible(result: MangaDexResolveResult | null): {
  eligible: boolean;
  reason: "title_not_found" | "no_chapters_in_lang" | "all_external" | null;
} {
  if (result === null) {
    return { eligible: true, reason: "title_not_found" };
  }

  if (result.chaptersInLang.length === 0) {
    return { eligible: true, reason: "no_chapters_in_lang" };
  }

  const allExternal = result.chaptersInLang.every((c) => c.externalUrl !== null);
  if (allExternal) {
    return { eligible: true, reason: "all_external" };
  }

  return { eligible: false, reason: null };
}

// ---------------------------------------------------------------------------
// promptFallbackSite
// ---------------------------------------------------------------------------

export async function promptFallbackSite(
  sites: FallbackSiteOption[],
  nonTty: boolean,
  logger: Logger,
): Promise<FallbackSiteOption> {
  if (nonTty) {
    logger.warn(
      { event: "download.fallback_non_tty", context: "download" },
      "fallback site prompt requires a TTY",
    );
    throw new CliError(
      "Fallback site selection requires an interactive terminal. Re-run in a terminal after setting up auth with `scanldr auth`.",
      2,
    );
  }

  const idx = await promptNumericChoice({
    header: "MangaDex unavailable. Choose a fallback site:",
    items: sites.map((s) => ({ display: s.display })),
    logger,
    event: "download.invalid_selection",
  });
  return sites[idx] as FallbackSiteOption;
}

// ---------------------------------------------------------------------------
// pickCandidate — mirrors resolveTitle's UX for mangakakalot results
// ---------------------------------------------------------------------------

async function pickCandidate(
  candidates: Array<{ id: string; title: string }>,
  nonTty: boolean,
  logger: Logger,
  siteName: string,
): Promise<{ id: string; title: string }> {
  if (candidates.length === 1) return candidates[0] as { id: string; title: string };

  if (nonTty) {
    const list = candidates.map((c, i) => `  [${i + 1}] ${c.title}`).join("\n");
    logger.warn(
      { event: "download.fallback_ambiguous_title", context: "download", site: siteName },
      "multiple candidates on fallback site in non-TTY mode",
    );
    throw new CliError(
      `Multiple results on ${siteName}. Re-run in a terminal to pick one:\n${list}`,
      2,
    );
  }

  const idx = await promptNumericChoice({
    header: `Multiple results on ${siteName}:`,
    items: candidates.map((c) => ({ display: c.title })),
    logger,
    event: "download.invalid_selection",
  });
  return candidates[idx] as { id: string; title: string };
}

// ---------------------------------------------------------------------------
// makeMangakakalotFetcher
// ---------------------------------------------------------------------------

function makeMangakakalotFetcher(
  http: FallbackHttpClient,
  logger: Logger,
): (ref: ImageRef) => Promise<Uint8Array> {
  return async (ref) => {
    logger.info(
      { event: "mangakakalot.image_fetch", context: "mangakakalot", url: ref.url },
      "fetching image from mangakakalot",
    );
    // 2xstorage.com CDN requires a Referer header to return 200; omitting it yields 403.
    const res = await http.get(ref.url, { referer: "https://www.mangakakalot.gg/" });
    if (!res.ok) {
      throw new Error(`mangakakalot image fetch failed: HTTP ${res.status} for ${ref.url}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  };
}

// ---------------------------------------------------------------------------
// buildFallbackBundles
// ---------------------------------------------------------------------------

function compareVolumeTokens(a: string, b: string): number {
  if (a === "none" && b === "none") return 0;
  if (a === "none") return 1;
  if (b === "none") return -1;
  const an = Number(a);
  const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return a.localeCompare(b);
}

export function buildFallbackBundles(opts: {
  args: DownloadArgs;
  requestedTokens: Set<string>;
  mangadexVolumes: VolumeRef[];
  mangadexChapters: ChapterRef[];
  mkChapters: ChapterRef[];
  logger: Logger;
}): FallbackBundle[] {
  const { args, requestedTokens, mangadexVolumes, mangadexChapters, mkChapters, logger } = opts;
  const bundles: FallbackBundle[] = [];

  if (args.volume !== undefined) {
    for (const volToken of requestedTokens) {
      const mdVolume = mangadexVolumes.find((v) => v.volume === volToken);
      if (!mdVolume) {
        logger.warn(
          { event: "download.fallback_volume_missing", context: "download", volume: volToken },
          `volume ${volToken} not found in MangaDex aggregate; skipping`,
        );
        continue;
      }

      // MangaDex chapter IDs → chapter numbers via chaptersInLang
      const mdChapterNums = mdVolume.chapterIds
        .map((id) => mangadexChapters.find((c) => c.id === id)?.chapter)
        .filter((n): n is string => n !== null && n !== undefined);

      // Find mangakakalot chapters matching those numbers
      const mkChaptersForVolume = mkChapters.filter(
        (c) => c.chapter !== null && mdChapterNums.includes(c.chapter),
      );

      const missing = mdChapterNums.filter(
        (n) => !mkChaptersForVolume.some((c) => c.chapter === n),
      );
      if (missing.length > 0) {
        logger.warn(
          {
            event: "download.fallback_chapters_missing",
            context: "download",
            volume: volToken,
            missing,
          },
          `chapters ${missing.join(", ")} from MangaDex not found on fallback site`,
        );
      }

      if (mkChaptersForVolume.length === 0) continue;

      bundles.push({
        kind: "volume",
        bundleNumber: volToken,
        volumeForHistory: volToken,
        chapters: mkChaptersForVolume,
      });
    }
  } else {
    // --chapter mode
    for (const chToken of requestedTokens) {
      const mkCh = mkChapters.find((c) => c.chapter === chToken);
      if (!mkCh) {
        logger.warn(
          { event: "download.fallback_chapter_missing", context: "download", chapter: chToken },
          `chapter ${chToken} not found on fallback site; skipping`,
        );
        continue;
      }

      // Look up volume from MangaDex chaptersInLang if possible
      const mdCh = mangadexChapters.find((c) => c.chapter === chToken);
      const volumeForHistory = mdCh?.volume ?? "none";

      bundles.push({
        kind: "chapter",
        bundleNumber: chToken,
        volumeForHistory,
        chapters: [mkCh],
      });
    }
  }

  return bundles;
}

// ---------------------------------------------------------------------------
// buildFallbackBundlesFromVolumeMap
// Used when volumeMappingSource === 'fallback' (all_external series).
// ---------------------------------------------------------------------------

export function buildFallbackBundlesFromVolumeMap(opts: {
  args: DownloadArgs;
  requestedTokens: Set<string>;
  volumeMap: VolumeMap;
  logger: Logger;
}): FallbackBundle[] {
  const { args, requestedTokens, volumeMap, logger } = opts;

  if (args.volume === undefined) {
    // --chapter mode: find chapter directly from all buckets (flat lookup).
    const bundles: FallbackBundle[] = [];
    for (const chToken of requestedTokens) {
      let found = false;
      for (const bucket of volumeMap) {
        const match = bucket.chapters.find((c) => c.chapter === chToken);
        if (match) {
          const volumeForHistory = bucket.volume === "unknown" ? "none" : bucket.volume;
          bundles.push({
            kind: "chapter",
            bundleNumber: chToken,
            volumeForHistory,
            chapters: [
              {
                id: match.id,
                volume: volumeForHistory,
                chapter: chToken,
                title: null,
                translatedLanguage: "en",
                scanlationGroup: null,
                readableAt: "",
                externalUrl: null,
              },
            ],
          });
          found = true;
          break;
        }
      }
      if (!found) {
        logger.warn(
          { event: "download.fallback_chapter_missing", context: "download", chapter: chToken },
          `chapter ${chToken} not found on fallback site; skipping`,
        );
      }
    }
    return bundles;
  }

  // --volume mode: use volumeMap buckets as authoritative source.
  const bundles: FallbackBundle[] = [];

  for (const volToken of requestedTokens) {
    const bucket = volumeMap.find((b) => b.volume === volToken);
    if (!bucket || bucket.chapters.length === 0) {
      logger.warn(
        { event: "download.fallback_volume_missing", context: "download", volume: volToken },
        `volume ${volToken} not found in fallback site mapping; skipping`,
      );
      continue;
    }

    const chapters: ChapterRef[] = bucket.chapters.map((c) => ({
      id: c.id,
      volume: volToken,
      chapter: c.chapter,
      title: null,
      translatedLanguage: "en",
      scanlationGroup: null,
      readableAt: "",
      externalUrl: null,
    }));

    bundles.push({
      kind: "volume",
      bundleNumber: volToken,
      volumeForHistory: volToken,
      chapters,
    });
  }

  return bundles;
}

// ---------------------------------------------------------------------------
// runFallbackDownload
// ---------------------------------------------------------------------------

export async function runFallbackDownload(opts: {
  args: DownloadArgs;
  ctx: DownloadContext;
  mangadexResolve: MangaDexResolveResult | null;
  createFallbackHttp: (
    opts: import("@integrations/fallback-http/types.ts").FallbackHttpOptions,
  ) => Promise<import("@integrations/fallback-http/types.ts").FallbackHttpClient>;
  createMangakakalotClient: (opts: {
    http: import("@integrations/fallback-http/types.ts").FallbackHttpClient;
    logger: Logger;
  }) => import("@integrations/mangakakalot/client/types.ts").MangakakalotClient;
  /**
   * Controls where volume→chapter mapping is sourced from.
   * 'fallback' — parse from the fallback site manga page (required for all_external series).
   * 'mangadex' — use MangaDex aggregate (default, preserves existing behaviour).
   */
  volumeMappingSource?: "mangadex" | "fallback";
  /** Override for tests — bypasses stdin prompt. When provided, nonTty check is skipped. */
  promptSite?: (sites: FallbackSiteOption[]) => Promise<FallbackSiteOption>;
}): Promise<void> {
  const {
    args,
    ctx,
    mangadexResolve,
    createFallbackHttp: mkFallbackHttp,
    createMangakakalotClient: mkClientFactory,
    volumeMappingSource = "mangadex",
    promptSite,
  } = opts;
  const { logger } = ctx;

  // Volume mode with mangadex source requires MangaDex aggregate to map volumes → chapter numbers.
  // When volumeMappingSource === 'fallback', we skip this guard and source from the manga page.
  if (
    args.volume !== undefined &&
    volumeMappingSource === "mangadex" &&
    (!mangadexResolve || mangadexResolve.volumes.length === 0)
  ) {
    logger.warn(
      { event: "download.fallback_no_volume_metadata", context: "download" },
      "MangaDex has no volume data; --chapter is required for fallback",
    );
    throw new CliError(
      "MangaDex doesn't know this title's volumes. Re-run with --chapter <range> to download from a fallback site.",
      2,
    );
  }

  const sites: FallbackSiteOption[] = [{ name: "mangakakalot", display: "mangakakalot.gg" }];
  const site = promptSite
    ? await promptSite(sites)
    : await promptFallbackSite(sites, args.nonTty, logger);

  // Bootstrap fallback HTTP + mangakakalot client (createFallbackHttp is async — reads auth.json).
  // MissingAuthError and CloudflareError propagate as-is so the entry point can handle them
  // with their typed messages (the user needs to see the original message).
  const fallbackHttp: FallbackHttpClient = await mkFallbackHttp({ logger });

  const mkClient = mkClientFactory({ http: fallbackHttp, logger });

  // Resolve title on mangakakalot
  const titleToSearch = mangadexResolve?.candidate.title ?? args.manga;
  logger.info(
    {
      event: "download.fallback_search",
      context: "download",
      title: titleToSearch,
      site: site.name,
    },
    "searching on fallback site",
  );
  const mkCandidates = await mkClient.searchManga(titleToSearch);
  if (mkCandidates.length === 0) {
    logger.warn(
      {
        event: "download.fallback_not_found",
        context: "download",
        title: titleToSearch,
        site: site.name,
      },
      "title not found on fallback site",
    );
    throw new CliError(`Title "${titleToSearch}" not found on ${site.display}.`, 2);
  }

  const mkChosen = await pickCandidate(mkCandidates, args.nonTty, logger, site.name);

  logger.info(
    {
      event: "download.fallback_resolved",
      context: "download",
      id: mkChosen.id,
      title: mkChosen.title,
    },
    "title resolved on fallback site",
  );

  const requestedTokens =
    args.volume !== undefined
      ? parseRangeSet(args.volume).values
      : parseRangeSet(args.chapter as string).values;

  let bundles: FallbackBundle[];

  // Invariant: volumeMappingSource='fallback' is only valid when --volume is set.
  // --chapter + 'fallback' is an internal caller error: getVolumeMap (HTML parser) is unreliable
  // for real titles; getChapterList (JSON API) must be used for chapter mode.
  if (volumeMappingSource === "fallback" && args.volume === undefined) {
    throw new CliError(
      "Internal: chapter-mode with volumeMappingSource='fallback' is not supported. Use volumeMappingSource='mangadex' for chapter mode.",
      2,
    );
  }

  if (volumeMappingSource === "fallback") {
    // Source volume→chapter mapping from the fallback site manga page.
    logger.info(
      { event: "download.fallback_volume_map_fetch", context: "download", slug: mkChosen.id },
      "fetching volume mapping from fallback site",
    );
    let volumeMap: VolumeMap;
    try {
      volumeMap = await mkClient.getVolumeMap(mkChosen.id);
    } catch (err) {
      if (err instanceof MangakakalotParseError) {
        logger.warn(
          {
            event: "mangakakalot.parse_drift",
            context: "fallback",
            selector: err.selector,
            url: err.url,
            err,
          },
          "parser DOM drift detected — fallback site may have changed structure",
        );
        throw new CliError(
          "Volume mapping not available on the fallback site. Use --chapter <range> instead.",
          2,
        );
      }
      throw err;
    }

    if (args.volume !== undefined && volumeMap.length === 0) {
      logger.warn(
        { event: "download.fallback_volume_map_empty", context: "download", slug: mkChosen.id },
        "fallback site manga page returned no volume mapping",
      );
      throw new CliError(
        "Volume mapping not available on the fallback site. Use --chapter <range> instead.",
        2,
      );
    }

    bundles = buildFallbackBundlesFromVolumeMap({
      args,
      requestedTokens,
      volumeMap,
      logger,
    });

    // Volume mode: all requested tokens missing → specific error with available volumes.
    if (args.volume !== undefined && bundles.length === 0) {
      const requested = [...requestedTokens].sort(compareVolumeTokens);
      const available = volumeMap
        .map((b) => b.volume)
        .filter((v) => v !== "unknown")
        .sort(compareVolumeTokens);
      logger.warn(
        {
          event: "download.fallback_no_volumes_matched",
          context: "download",
          requested,
          available,
          source: "fallback",
        },
        "no requested volume tokens found in fallback site mapping",
      );
      throw new CliError(
        `Volume ${requested.join(", ")} not found in fallback site mapping for "${mkChosen.title}". Available volumes: ${available.join(", ")}. Use --chapter <range> if you need partial.`,
        2,
      );
    }
  } else {
    // Default: source from MangaDex aggregate (original path).
    const mkChapters = await mkClient.getChapterList(mkChosen.id);

    bundles = buildFallbackBundles({
      args,
      requestedTokens,
      mangadexVolumes: mangadexResolve?.volumes ?? [],
      mangadexChapters: mangadexResolve?.chaptersInLang ?? [],
      mkChapters,
      logger,
    });

    // Guard: volume mode + MangaDex has volumes, but none of the requested ones are in the mapping.
    if (
      args.volume !== undefined &&
      bundles.length === 0 &&
      mangadexResolve &&
      mangadexResolve.volumes.length > 0
    ) {
      const requested = [...requestedTokens].sort(compareVolumeTokens);
      const available = mangadexResolve.volumes.map((v) => v.volume).sort(compareVolumeTokens);
      logger.warn(
        {
          event: "download.fallback_no_volumes_matched",
          context: "download",
          requested,
          available,
        },
        "no requested volume tokens are mapped in MangaDex aggregate",
      );
      throw new CliError(
        `None of the requested volumes are mapped in MangaDex's aggregate for "${mangadexResolve.candidate.title}". Available mapped volumes: ${available.join(", ")}. Use --chapter <range> instead: MangaDex doesn't track this volume for this title (likely partner-published series).`,
        2,
      );
    }
  }

  const slug = toSlug(mkChosen.title, logger);

  const successPaths: PackedChapter[] = [];
  let failureCount = 0;

  for (const bundle of bundles) {
    try {
      const outputPath = await processFallbackBundle({
        bundle,
        slug,
        mangaId: mkChosen.id,
        mangaTitle: mkChosen.title,
        args,
        ctx,
        mkClient,
        fallbackHttp,
        site: site.name,
      });
      if (outputPath !== null) {
        successPaths.push({ num: bundle.bundleNumber, outputPath });
      }
    } catch (err) {
      // CliError = user-facing content/policy error — propagate immediately.
      // Other errors (network, infrastructure) = recoverable partial failure → log + continue.
      if (err instanceof CliError) {
        throw err;
      }
      failureCount++;
      logger.warn(
        {
          event: "download.bundle_failed",
          context: "download",
          kind: bundle.kind,
          bundleNumber: bundle.bundleNumber,
          err,
        },
        `${bundle.kind} ${bundle.bundleNumber} failed; continuing with remaining bundles`,
      );
    }
  }

  // Pack flow: only for --chapter mode, N > 1 success, no failures
  if (args.chapter !== undefined && successPaths.length > 1) {
    if (failureCount > 0) {
      logger.warn(
        { event: "pack.skipped", context: "pack", reason: "partial_failures", failureCount },
        "packing skipped due to partial download failures",
      );
      process.stderr.write(
        `Warning: packing skipped because ${failureCount} chapter(s) failed to download. Re-run with --pack after fixing.\n`,
      );
      return;
    }

    await runPackFlow({ args, ctx, slug, successPaths });
  }
}

// ---------------------------------------------------------------------------
// processFallbackBundle
// ---------------------------------------------------------------------------

/** Returns outputPath on success, null when the bundle was skipped (history/dryRun). */
async function processFallbackBundle(opts: {
  bundle: FallbackBundle;
  slug: string;
  mangaId: string;
  mangaTitle: string;
  args: DownloadArgs;
  ctx: DownloadContext;
  mkClient: ReturnType<typeof createMangakakalotClient>;
  fallbackHttp: FallbackHttpClient;
  site: string;
}): Promise<string | null> {
  const { bundle, slug, mangaId, mangaTitle, args, ctx, mkClient, fallbackHttp, site } = opts;
  const { logger, db } = ctx;
  const { kind, bundleNumber, volumeForHistory, chapters } = bundle;

  // History skip check
  if (!args.force) {
    const chapterIdSet = new Set(chapters.map((c) => c.id));
    const fullyDownloaded = isVolumeFullyDownloaded(db, {
      mangaId,
      volume: volumeForHistory,
      language: MANGAKAKALOT_LANGUAGE,
      expectedChapterIds: chapterIdSet,
    });

    if (fullyDownloaded) {
      logger.info(
        { event: "download.bundle_skip", context: "download", kind, bundleNumber },
        `skipping ${kind} ${bundleNumber}: already in history`,
      );
      return null;
    }
  }

  // Build chapter inputs: each chapter fetches image list then constructs fetcher
  const chapterInputs: ChapterInput[] = await Promise.all(
    chapters.map(async (ch) => {
      const imageRefs = await mkClient.getChapterImages(ch.id);
      return {
        id: ch.id,
        num: Number(ch.chapter ?? "0"),
        pages: imageRefs,
        imageFetcher: makeMangakakalotFetcher(fallbackHttp, logger),
      };
    }),
  );

  if (args.dryRun) {
    const totalPages = chapterInputs.reduce((sum, c) => sum + c.pages.length, 0);
    logger.info(
      {
        event: "download.dry_run",
        context: "download",
        slug,
        kind,
        bundleNumber,
        chapters: chapterInputs.length,
        totalPages,
      },
      `dry-run: would download ${kind} ${bundleNumber} from ${site}`,
    );
    return null;
  }

  const result = await downloadBundle({
    outDir: args.outDir,
    format: args.format,
    slug,
    kind,
    bundleNumber,
    chapters: chapterInputs,
    imageConcurrency: args.concurrency,
    delayMs: args.delayMs,
    dryRun: false,
    logger,
  });

  logger.info(
    {
      event: "download.bundle_done",
      context: "download",
      kind,
      bundleNumber,
      outputPath: result.outputPath,
      byteSize: result.byteSize,
    },
    `${kind} ${bundleNumber} downloaded from ${site}`,
  );

  if (!args.noTrack) {
    const rows: DownloadRow[] = chapters.map((ch) => ({
      mangaId,
      mangaTitle,
      volume: volumeForHistory,
      chapterId: ch.id,
      chapterNum: ch.chapter ?? "0",
      source: site,
      language: MANGAKAKALOT_LANGUAGE,
      downloadedAt: Date.now(),
    }));
    recordDownloadedChapters(db, rows);
    logger.info(
      {
        event: "download.history_recorded",
        context: "download",
        kind,
        bundleNumber,
        rows: rows.length,
      },
      "history recorded",
    );
  }

  return result.outputPath;
}
