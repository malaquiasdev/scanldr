import { createInterface } from "node:readline";
import {
  AtHomeError,
  getAtHomeServer,
  mangadexImageFetcher,
} from "@integrations/mangadex/at-home/index.ts";
import type { ChapterRef, MangaCandidate } from "@integrations/mangadex/client/index.ts";
import type { MangaDexClient } from "@integrations/mangadex/client/index.ts";
import { parseExternalHost } from "@integrations/mangadex/external-host.ts";
import type { MangaDexHttpClient } from "@integrations/mangadex/http/index.ts";
import { downloadBundle } from "@modules/downloader/index.ts";
import type { ChapterInput } from "@modules/downloader/types.ts";
import { isVolumeFullyDownloaded, recordDownloadedChapters } from "@modules/history/index.ts";
import type { DownloadRow } from "@modules/history/index.ts";
import { CliError } from "@plugins/errors/index.ts";
import { resolveLanguage } from "./language.ts";
import { parseRangeSet } from "./range.ts";
import { toSlug } from "./slug.ts";
import type { Bundle, DownloadArgs, DownloadContext, ProcessBundleArgs } from "./types.ts";

export type { DownloadArgs, DownloadContext } from "./types.ts";
export { CliError } from "@plugins/errors/index.ts";

/** Prompt user to pick one from a list of candidates with titles */
function promptCandidatePick(candidates: { title: string }[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const list = candidates.map((c, i) => `  [${i + 1}] ${c.title}`).join("\n");
    process.stderr.write(`Multiple results found:\n${list}\nPick one: `);
    rl.once("line", (line) => {
      rl.close();
      const n = Number.parseInt(line.trim(), 10);
      if (Number.isNaN(n) || n < 1 || n > candidates.length) {
        reject(new CliError(`Invalid selection: "${line.trim()}"`, 2));
      } else {
        resolve(n - 1);
      }
    });
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
    chosenIndex = await promptCandidatePick(candidates);
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
 * --chapter: one bundle per requested chapter token, one chapter each.
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

  // --chapter mode
  const { values: requestedChapters } = parseRangeSet(args.chapter as string);
  const chapterNumToRef = new Map<string, ChapterRef>();
  for (const ch of chaptersInLang) {
    const num = ch.chapter ?? "0";
    if (!chapterNumToRef.has(num)) {
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
      // Use the chapter's real volume from MangaDex; null → "none"
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

  // history check — use volumeForHistory as the volume key (consistent across volume/chapter mode)
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

  // external-chapter check
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

export async function runDownload(
  args: DownloadArgs,
  ctx: DownloadContext,
  client: MangaDexClient,
  http: MangaDexHttpClient,
): Promise<void> {
  const { logger, config } = ctx;

  // Validate: exactly one of volume/chapter must be set
  if (args.volume !== undefined && args.chapter !== undefined) {
    logger.warn(
      { event: "download.mutual_exclusion", context: "download" },
      "--volume and --chapter are mutually exclusive",
    );
    throw new CliError("--volume and --chapter are mutually exclusive", 2);
  }

  if (args.volume === undefined && args.chapter === undefined) {
    throw new CliError("--volume <range> or --chapter <range> is required", 2);
  }

  if (args.volume !== undefined) {
    const { values: requestedVolumes } = parseRangeSet(args.volume);
    if (requestedVolumes.has("none")) {
      throw new CliError(
        "--volume none is not yet supported. Use a numeric volume number instead.",
        2,
      );
    }
  }

  if (args.chapter !== undefined) {
    const { values: requestedChapters } = parseRangeSet(args.chapter);
    if (requestedChapters.has("none")) {
      logger.warn(
        { event: "download.chapter_none_unsupported", context: "download" },
        "--chapter none is not supported",
      );
      throw new CliError(
        "--chapter none is not yet supported. Use a numeric chapter number instead.",
        2,
      );
    }
  }

  const chosen = await resolveTitle(client, args.manga, args.nonTty, logger);

  const preferred = config.preferred_languages;

  // aggregateVolumes primes the MangaDex aggregate cache used by feedChapters
  await client.aggregateVolumes(chosen.id, preferred);

  const feedChapters = await client.feedChapters(chosen.id, preferred);
  const availableLanguages = [...new Set(feedChapters.map((c) => c.translatedLanguage))];

  const language = await resolveLanguage({
    preferred,
    available: availableLanguages,
    nonTty: args.nonTty,
    logger,
  });

  const chaptersInLang = feedChapters.filter((c) => c.translatedLanguage === language);

  const slug = toSlug(chosen.title, logger);

  const bundles = groupChaptersIntoBundles(args, chaptersInLang);

  // Warn about requested items missing from feed
  if (args.volume !== undefined) {
    const { values: requestedVolumes } = parseRangeSet(args.volume);
    const foundVolumeTokens = new Set(bundles.map((b) => b.bundleNumber));
    for (const token of requestedVolumes) {
      if (!foundVolumeTokens.has(token)) {
        logger.warn(
          { event: "download.volume_missing", context: "download", volume: token },
          `volume ${token} not found in feed; skipping`,
        );
      }
    }
  } else if (args.chapter !== undefined) {
    const { values: requestedChapters } = parseRangeSet(args.chapter);
    const foundChapterTokens = new Set(bundles.map((b) => b.bundleNumber));
    for (const token of requestedChapters) {
      if (!foundChapterTokens.has(token)) {
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
