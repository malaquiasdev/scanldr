// Fallback download path — entered when MangaDex is unavailable for a title.
// Handles site-picker prompt, mangakakalot client bootstrap, bundle construction,
// image fetching, and history recording.

import { createInterface } from "node:readline";
import type { ChapterRef, VolumeRef } from "@integrations/_shared/manga.ts";
import { MissingAuthError } from "@integrations/fallback-http/index.ts";
import type { FallbackHttpClient } from "@integrations/fallback-http/types.ts";
import type { createMangakakalotClient } from "@integrations/mangakakalot/client/index.ts";
import { downloadBundle } from "@modules/downloader/index.ts";
import type { ImageRef } from "@modules/downloader/types.ts";
import type { ChapterInput } from "@modules/downloader/types.ts";
import { isVolumeFullyDownloaded, recordDownloadedChapters } from "@modules/history/index.ts";
import type { DownloadRow } from "@modules/history/index.ts";
import { CliError } from "@plugins/errors/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import type {
  FallbackBundle,
  FallbackSiteOption,
  MangaDexResolveResult,
} from "./fallback-types.ts";
import { parseRangeSet } from "./range.ts";
import { toSlug } from "./slug.ts";
import type { DownloadArgs, DownloadContext } from "./types.ts";

export type {
  FallbackBundle,
  FallbackSiteOption,
  MangaDexResolveResult,
} from "./fallback-types.ts";

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

  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const list = sites.map((s, i) => `  [${i + 1}] ${s.display}`).join("\n");
    process.stderr.write(`MangaDex unavailable. Choose a fallback site:\n${list}\nPick one: `);
    rl.once("line", (line) => {
      rl.close();
      const n = Number.parseInt(line.trim(), 10);
      if (Number.isNaN(n) || n < 1 || n > sites.length) {
        reject(new CliError(`Invalid selection: "${line.trim()}"`, 2));
      } else {
        resolve(sites[n - 1] as FallbackSiteOption);
      }
    });
  });
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

  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const list = candidates.map((c, i) => `  [${i + 1}] ${c.title}`).join("\n");
    process.stderr.write(`Multiple results on ${siteName}:\n${list}\nPick one: `);
    rl.once("line", (line) => {
      rl.close();
      const n = Number.parseInt(line.trim(), 10);
      if (Number.isNaN(n) || n < 1 || n > candidates.length) {
        reject(new CliError(`Invalid selection: "${line.trim()}"`, 2));
      } else {
        resolve(candidates[n - 1] as { id: string; title: string });
      }
    });
  });
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
    const res = await http.get(ref.url);
    if (!res.ok) {
      throw new Error(`mangakakalot image fetch failed: HTTP ${res.status} for ${ref.url}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  };
}

// ---------------------------------------------------------------------------
// buildFallbackBundles
// ---------------------------------------------------------------------------

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
  /** Override for tests — bypasses stdin prompt. When provided, nonTty check is skipped. */
  _promptFallbackSite?: (sites: FallbackSiteOption[]) => Promise<FallbackSiteOption>;
}): Promise<void> {
  const {
    args,
    ctx,
    mangadexResolve,
    createFallbackHttp: mkFallbackHttp,
    createMangakakalotClient: mkClientFactory,
    _promptFallbackSite,
  } = opts;
  const { logger } = ctx;

  // Volume mode requires MangaDex aggregate to map volumes → chapter numbers
  if (args.volume !== undefined && (!mangadexResolve || mangadexResolve.volumes.length === 0)) {
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
  const site = _promptFallbackSite
    ? await _promptFallbackSite(sites)
    : await promptFallbackSite(sites, args.nonTty, logger);

  // Bootstrap fallback HTTP + mangakakalot client (createFallbackHttp is async — reads auth.json)
  let fallbackHttp: FallbackHttpClient;
  try {
    fallbackHttp = await mkFallbackHttp({ logger });
  } catch (err) {
    if (err instanceof MissingAuthError) {
      logger.warn(
        { event: "download.fallback_missing_auth", context: "download", err },
        "missing auth.json for fallback site",
      );
      throw new CliError(
        `${err.message} Run \`scanldr auth\` to capture a session before using fallback sites.`,
        2,
      );
    }
    throw err;
  }

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

  const mkChapters = await mkClient.getChapterList(mkChosen.id);

  const requestedTokens =
    args.volume !== undefined
      ? parseRangeSet(args.volume).values
      : parseRangeSet(args.chapter as string).values;

  const bundles = buildFallbackBundles({
    args,
    requestedTokens,
    mangadexVolumes: mangadexResolve?.volumes ?? [],
    mangadexChapters: mangadexResolve?.chaptersInLang ?? [],
    mkChapters,
    logger,
  });

  const slug = toSlug(mkChosen.title, logger);

  for (const bundle of bundles) {
    await processFallbackBundle({
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
  }
}

// ---------------------------------------------------------------------------
// processFallbackBundle
// ---------------------------------------------------------------------------

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
}): Promise<void> {
  const { bundle, slug, mangaId, mangaTitle, args, ctx, mkClient, fallbackHttp, site } = opts;
  const { logger, db } = ctx;
  const { kind, bundleNumber, volumeForHistory, chapters } = bundle;

  // History skip check
  if (!args.force) {
    const chapterIdSet = new Set(chapters.map((c) => c.id));
    const fullyDownloaded = isVolumeFullyDownloaded(db, {
      mangaId,
      volume: volumeForHistory,
      language: "en",
      expectedChapterIds: chapterIdSet,
    });

    if (fullyDownloaded) {
      logger.info(
        { event: "download.bundle_skip", context: "download", kind, bundleNumber },
        `skipping ${kind} ${bundleNumber}: already in history`,
      );
      return;
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
    return;
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
      language: "en",
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
}
