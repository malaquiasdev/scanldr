import { createFallbackHttp } from "@integrations/fallback-http/index.ts";
import {
  AtHomeError,
  getAtHomeServer,
  mangadexImageFetcher,
} from "@integrations/mangadex/at-home/index.ts";
import type { ChapterRef, MangaCandidate } from "@integrations/mangadex/client/index.ts";
import type { MangaDexClient } from "@integrations/mangadex/client/index.ts";
import { TitleNotFoundError } from "@integrations/mangadex/client/index.ts";
import { parseExternalHost } from "@integrations/mangadex/external-host.ts";
import type { MangaDexHttpClient } from "@integrations/mangadex/http/index.ts";
import { createMangakakalotClient } from "@integrations/mangakakalot/client/index.ts";
import { downloadBundle } from "@modules/downloader/index.ts";
import type { ChapterInput } from "@modules/downloader/types.ts";
import { isVolumeFullyDownloaded, recordDownloadedChapters } from "@modules/history/index.ts";
import type { DownloadRow } from "@modules/history/index.ts";
import { CliError } from "@plugins/errors/index.ts";
import type { MangaDexResolveResult } from "./fallback-types.ts";
import { isFallbackEligible, runFallbackDownload } from "./fallback.ts";
import { promptNumericChoice } from "./prompt.ts";
import { parseRangeSet } from "./range.ts";
import { toSlug } from "./slug.ts";
import type { Bundle, DownloadArgs, DownloadContext, ProcessBundleArgs } from "./types.ts";

export type { DownloadArgs, DownloadContext } from "./types.ts";
export { CliError } from "@plugins/errors/index.ts";

/** Prompt user to pick one from a list of candidates with titles */
function promptCandidatePick(
  candidates: { title: string }[],
  logger: DownloadContext["logger"],
): Promise<number> {
  return promptNumericChoice({
    header: "Multiple results found:",
    items: candidates.map((c) => ({ display: c.title })),
    logger,
    event: "download.invalid_selection",
  });
}

/** Resolve a manga title string to a single candidate. Throws CliError on ambiguity in non-TTY. */
async function resolveTitle(
  client: MangaDexClient,
  manga: string,
  nonTty: boolean,
  logger: DownloadContext["logger"],
): Promise<MangaCandidate> {
  logger.info(
    { event: "download.search_start", context: "download", title: manga },
    "searching manga",
  );

  const candidates = await client.resolveTitleToId(manga);

  let chosenIndex = 0;
  if (candidates.length > 1) {
    if (nonTty) {
      const list = candidates.map((c, i) => `  [${i + 1}] ${c.title}`).join("\n");
      logger.warn(
        {
          event: "download.ambiguous_title",
          context: "download",
          manga,
          candidateCount: candidates.length,
        },
        "multiple candidates found in non-TTY mode; cannot prompt user",
      );
      throw new CliError(
        `Multiple results found for "${manga}". Re-run in a terminal to pick one:\n${list}`,
        2,
      );
    }
    chosenIndex = await promptCandidatePick(candidates, logger);
  }

  const chosen = candidates[chosenIndex];
  if (!chosen) throw new CliError("No candidate selected", 2);

  logger.info(
    { event: "download.manga_resolved", context: "download", id: chosen.id, title: chosen.title },
    "manga resolved",
  );

  return chosen;
}

/** Build ChapterInput[] for a set of chapters. Throws on at-home failure. */
async function buildChapterInputs(
  chapters: ChapterRef[],
  http: MangaDexHttpClient,
  quality: DownloadArgs["quality"],
  logger: DownloadContext["logger"],
): Promise<ChapterInput[]> {
  const inputs: ChapterInput[] = [];

  for (const ch of chapters) {
    const server = await getAtHomeServer(http, ch.id, quality, logger);

    inputs.push({
      id: ch.id,
      num: Number(ch.chapter ?? "0"),
      pages: server.pages.map((filename, i) => ({ url: filename, page: i + 1 })),
      imageFetcher: mangadexImageFetcher(ch.id, {
        httpClient: http,
        logger,
        quality,
      }),
    });
  }

  return inputs;
}

/**
 * Group chapters from the feed into bundles based on args.
 * --volume: one bundle per requested volume token, all chapters in that volume.
 * --chapter: one bundle per requested chapter token, tiebreak: latest readableAt wins.
 */
function groupChaptersIntoBundles(args: DownloadArgs, chaptersInLang: ChapterRef[]): Bundle[] {
  if (args.volume !== undefined) {
    const { values: requestedVolumes } = parseRangeSet(args.volume);
    const volumeToChapters = new Map<string, ChapterRef[]>();
    for (const ch of chaptersInLang) {
      const vol = ch.volume ?? "none";
      const existing = volumeToChapters.get(vol) ?? [];
      existing.push(ch);
      volumeToChapters.set(vol, existing);
    }

    const bundles: Bundle[] = [];
    for (const volumeToken of requestedVolumes) {
      const volChapters = volumeToChapters.get(volumeToken);
      if (!volChapters || volChapters.length === 0) continue;
      bundles.push({
        kind: "volume",
        bundleNumber: volumeToken,
        volumeForHistory: volumeToken,
        chapters: volChapters,
      });
    }
    return bundles;
  }

  const { values: requestedChapters } = parseRangeSet(args.chapter as string);
  const chapterNumToRef = new Map<string, ChapterRef>();
  for (const ch of chaptersInLang) {
    if (ch.chapter === null) continue;
    const num = ch.chapter;
    const existing = chapterNumToRef.get(num);
    if (!existing || ch.readableAt > existing.readableAt) {
      chapterNumToRef.set(num, ch);
    }
  }

  const bundles: Bundle[] = [];
  for (const chapterToken of requestedChapters) {
    const ch = chapterNumToRef.get(chapterToken);
    if (!ch) continue;
    bundles.push({
      kind: "chapter",
      bundleNumber: chapterToken,
      volumeForHistory: ch.volume ?? "none",
      chapters: [ch],
    });
  }
  return bundles;
}

/** Per-bundle pipeline: history check → external check → build inputs → download → record. */
async function processBundle(input: ProcessBundleArgs): Promise<void> {
  const { bundle, chosen, slug, language, args, ctx, http } = input;
  const { logger, db } = ctx;
  const { kind, bundleNumber, volumeForHistory, chapters } = bundle;

  if (!args.force) {
    const chapterIdSet = new Set(chapters.map((c) => c.id));
    const fullyDownloaded = isVolumeFullyDownloaded(db, {
      mangaId: chosen.id,
      volume: volumeForHistory,
      language,
      expectedChapterIds: chapterIdSet,
    });

    if (fullyDownloaded) {
      logger.info(
        {
          event: "download.bundle_skip",
          context: "download",
          kind,
          bundleNumber,
        },
        `skipping ${kind} ${bundleNumber}: already in history`,
      );
      return;
    }
  }

  for (const ch of chapters) {
    if (ch.externalUrl !== null) {
      const host = parseExternalHost(ch.externalUrl) ?? ch.externalUrl;
      logger.warn(
        {
          event: "download.external_chapter",
          context: "download",
          chapterId: ch.id,
          externalUrl: ch.externalUrl,
          host,
        },
        "chapter is partner-hosted; refusing download",
      );
      throw new CliError(
        `Chapter ${ch.chapter ?? ch.id} is hosted externally on ${host}. scanldr cannot download partner-hosted chapters. Open: ${ch.externalUrl}`,
        2,
      );
    }
  }

  let chapterInputs: Awaited<ReturnType<typeof buildChapterInputs>>;
  let result: Awaited<ReturnType<typeof downloadBundle>>;
  try {
    chapterInputs = await buildChapterInputs(chapters, http, args.quality, logger);

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
        `dry-run: would download ${kind} ${bundleNumber}`,
      );
      return;
    }

    result = await downloadBundle({
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
  } catch (err) {
    if (err instanceof AtHomeError && err.status === 404) {
      logger.warn(
        {
          event: "download.at_home_404",
          context: "download",
          chapterId: err.chapterId,
          status: err.status,
          err,
        },
        "at-home server returned 404; surfacing as user-facing CliError",
      );
      throw new CliError(err.message, 2);
    }
    throw err;
  }

  logger.info(
    {
      event: "download.bundle_done",
      context: "download",
      kind,
      bundleNumber,
      outputPath: result.outputPath,
      byteSize: result.byteSize,
    },
    `${kind} ${bundleNumber} downloaded`,
  );

  if (!args.noTrack) {
    const rows: DownloadRow[] = chapters.map((ch) => ({
      mangaId: chosen.id,
      mangaTitle: chosen.title,
      volume: volumeForHistory,
      chapterId: ch.id,
      chapterNum: ch.chapter ?? "0",
      source: "mangadex",
      language,
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

/**
 * Attempt the MangaDex pipeline.
 * Returns null when the title resolves to zero candidates (soft failure).
 * Returns MangaDexResolveResult with language: null when no chapters in preferred languages.
 * Throws on hard failures (network errors, etc.).
 */
async function tryMangaDexPipeline(
  args: DownloadArgs,
  ctx: DownloadContext,
  client: MangaDexClient,
): Promise<MangaDexResolveResult | null> {
  const { logger, config } = ctx;
  const preferred = config.preferred_languages;

  let candidate: MangaCandidate;
  try {
    candidate = await resolveTitle(client, args.manga, args.nonTty, logger);
  } catch (err) {
    if (err instanceof TitleNotFoundError) {
      return null;
    }
    // CliError from resolveTitle (ambiguous title non-TTY, etc.) — propagate
    throw err;
  }

  const volumes = await client.aggregateVolumes(candidate.id, preferred);
  const feedChapters = await client.feedChapters(candidate.id, preferred);
  const availableLanguages = [...new Set(feedChapters.map((c) => c.translatedLanguage))];

  // Soft language resolution — return null language instead of throwing
  let language: string | null = null;
  for (const lang of preferred) {
    if (availableLanguages.includes(lang)) {
      language = lang;
      break;
    }
  }

  const chaptersInLang = language
    ? feedChapters.filter((c) => c.translatedLanguage === language)
    : [];

  return { candidate, volumes, chaptersInLang, language };
}

/** MangaDex-only download path (original logic, factored out). */
async function runMangaDexDownload(
  args: DownloadArgs,
  ctx: DownloadContext,
  http: MangaDexHttpClient,
  resolve: MangaDexResolveResult,
): Promise<void> {
  const { logger } = ctx;
  const { candidate: chosen, chaptersInLang } = resolve;

  // language is guaranteed non-null here: isFallbackEligible returns eligible when
  // chaptersInLang is empty (language null) so we only reach this function when
  // chaptersInLang is non-empty (language non-null).
  const language = resolve.language as string;

  logger.info(
    { event: "download.language_resolved", context: "download", language },
    "language resolved from preferences",
  );

  const slug = toSlug(chosen.title, logger);

  const requestedTokens =
    args.volume !== undefined
      ? parseRangeSet(args.volume).values
      : parseRangeSet(args.chapter as string).values;

  const bundles = groupChaptersIntoBundles(args, chaptersInLang);

  const foundBundleTokens = new Set(bundles.map((b) => b.bundleNumber));
  for (const token of requestedTokens) {
    if (!foundBundleTokens.has(token)) {
      if (args.volume !== undefined) {
        logger.warn(
          { event: "download.volume_missing", context: "download", volume: token },
          `volume ${token} not found in feed; skipping`,
        );
      } else {
        logger.warn(
          { event: "download.chapter_missing", context: "download", chapter: token },
          `chapter ${token} not found in feed; skipping`,
        );
      }
    }
  }

  for (const bundle of bundles) {
    await processBundle({ bundle, chosen, slug, language, args, ctx, http });
  }
}

export async function runDownload(
  args: DownloadArgs,
  ctx: DownloadContext,
  client: MangaDexClient,
  http: MangaDexHttpClient,
): Promise<void> {
  const { logger } = ctx;

  if (args.volume !== undefined && args.chapter !== undefined) {
    logger.warn(
      { event: "download.mutual_exclusion", context: "download" },
      "--volume and --chapter are mutually exclusive",
    );
    throw new CliError("--volume and --chapter are mutually exclusive", 2);
  }

  if (args.volume === undefined && args.chapter === undefined) {
    logger.warn(
      { event: "download.no_flag_set", context: "download" },
      "--volume or --chapter is required",
    );
    throw new CliError("--volume <range> or --chapter <range> is required", 2);
  }

  const requestedTokens =
    args.volume !== undefined
      ? parseRangeSet(args.volume).values
      : parseRangeSet(args.chapter as string).values;

  if (args.volume !== undefined && requestedTokens.has("none")) {
    logger.warn(
      { event: "download.volume_none_unsupported", context: "download" },
      "--volume none is not supported",
    );
    throw new CliError(
      "--volume none is not yet supported. Use a numeric volume number instead.",
      2,
    );
  }

  if (args.chapter !== undefined && requestedTokens.has("none")) {
    logger.warn(
      { event: "download.chapter_none_unsupported", context: "download" },
      "--chapter none is not supported",
    );
    throw new CliError(
      "--chapter none is not yet supported. Use a numeric chapter number instead.",
      2,
    );
  }

  // Try MangaDex pipeline (soft failure on title-not-found, language-not-matched)
  // TitleNotFoundError is caught inside and converted to null.
  const mangadexResolve: MangaDexResolveResult | null = await tryMangaDexPipeline(
    args,
    ctx,
    client,
  );

  const eligibility = isFallbackEligible(mangadexResolve);

  if (eligibility.eligible) {
    logger.info(
      {
        event: "download.fallback_triggered",
        context: "download",
        reason: eligibility.reason,
        title: args.manga,
      },
      `MangaDex unavailable for "${args.manga}" (reason: ${eligibility.reason}); offering fallback`,
    );
    return runFallbackDownload({
      args,
      ctx,
      mangadexResolve,
      createFallbackHttp,
      createMangakakalotClient,
    });
  }

  // MangaDex path — mangadexResolve is non-null here (isFallbackEligible returned false)
  // biome-ignore lint/style/noNonNullAssertion: guaranteed non-null when !eligibility.eligible
  await runMangaDexDownload(args, ctx, http, mangadexResolve!);
}
