import { createInterface } from "node:readline";
import {
  AtHomeError,
  getAtHomeServer,
  mangadexImageFetcher,
} from "@integrations/mangadex/at-home/index.ts";
import type { ChapterRef, MangaCandidate } from "@integrations/mangadex/client/index.ts";
import type { MangaDexClient } from "@integrations/mangadex/client/index.ts";
import type { MangaDexHttpClient } from "@integrations/mangadex/http/index.ts";
import { downloadVolume } from "@modules/downloader/index.ts";
import type { ChapterInput } from "@modules/downloader/types.ts";
import { isVolumeFullyDownloaded, recordDownloadedChapters } from "@modules/history/index.ts";
import type { DownloadRow } from "@modules/history/index.ts";
import { CliError } from "@plugins/errors/index.ts";
import { resolveLanguage } from "./language.ts";
import { parseRangeSet } from "./range.ts";
import { toSlug } from "./slug.ts";
import type { DownloadArgs, DownloadContext } from "./types.ts";

export type { DownloadArgs, DownloadContext } from "./types.ts";
export { CliError } from "@plugins/errors/index.ts";
export { toSlug } from "./slug.ts";

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

/** Per-volume pipeline: history check → external check → build inputs → download → record. */
async function processVolume(
  volumeToken: string,
  volChapters: ChapterRef[],
  chosen: MangaCandidate,
  slug: string,
  language: string,
  args: DownloadArgs,
  ctx: DownloadContext,
  http: MangaDexHttpClient,
): Promise<void> {
  const { logger, db } = ctx;

  // history check
  if (!args.force) {
    const chapterIdSet = new Set(volChapters.map((c) => c.id));
    const fullyDownloaded = isVolumeFullyDownloaded(db, {
      mangaId: chosen.id,
      volume: volumeToken,
      language,
      expectedChapterIds: chapterIdSet,
    });

    if (fullyDownloaded) {
      logger.info(
        { event: "download.volume_skip", context: "download", volume: volumeToken },
        `skipping volume ${volumeToken}: already in history`,
      );
      return;
    }
  }

  // external-chapter check
  for (const ch of volChapters) {
    if (ch.externalUrl !== null) {
      const host = (() => {
        try {
          return new URL(ch.externalUrl).hostname;
        } catch {
          return ch.externalUrl;
        }
      })();
      throw new CliError(
        `Chapter ${ch.chapter ?? ch.id} is hosted externally on ${host}. scanldr cannot download partner-hosted chapters. Open: ${ch.externalUrl}`,
        2,
      );
    }
  }

  const volumeNumber = Number(volumeToken);
  const chapterInputs = await buildChapterInputs(volChapters, http, args.quality, logger);

  if (args.dryRun) {
    const totalPages = chapterInputs.reduce((sum, c) => sum + c.pages.length, 0);
    logger.info(
      {
        event: "download.dry_run",
        context: "download",
        slug,
        volumeNumber,
        chapters: chapterInputs.length,
        totalPages,
      },
      `dry-run: would download volume ${volumeToken}`,
    );
    return;
  }

  let result: Awaited<ReturnType<typeof downloadVolume>>;
  try {
    result = await downloadVolume({
      outDir: args.outDir,
      format: args.format,
      slug,
      volumeNumber,
      chapters: chapterInputs,
      imageConcurrency: args.concurrency,
      delayMs: args.delayMs,
      dryRun: false,
      logger,
    });
  } catch (err) {
    if (err instanceof AtHomeError && err.status === 404) {
      throw new CliError(err.message, 2);
    }
    throw err;
  }

  logger.info(
    {
      event: "download.volume_done",
      context: "download",
      volume: volumeToken,
      outputPath: result.outputPath,
      byteSize: result.byteSize,
    },
    `volume ${volumeToken} downloaded`,
  );

  if (!args.noTrack) {
    const rows: DownloadRow[] = volChapters.map((ch) => ({
      mangaId: chosen.id,
      mangaTitle: chosen.title,
      volume: volumeToken,
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
        volume: volumeToken,
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

  // 1. Parse range
  const { values: requestedVolumes } = parseRangeSet(args.volume);

  if (requestedVolumes.has("none")) {
    throw new CliError(
      "--volume none is not yet supported. Use a numeric volume number instead.",
      2,
    );
  }

  // 2. Resolve title → manga ID
  const chosen = await resolveTitle(client, args.manga, args.nonTty, logger);

  const preferred = config.preferred_languages;

  // 3. Aggregate volumes (early discovery)
  await client.aggregateVolumes(chosen.id, preferred);

  // 4. Fetch chapters and resolve language
  const feedChapters = await client.feedChapters(chosen.id, preferred);
  const availableLanguages = [...new Set(feedChapters.map((c) => c.translatedLanguage))];

  const language = await resolveLanguage({
    preferred,
    available: availableLanguages,
    nonTty: args.nonTty,
    logger,
  });

  // 5. Group chapters by volume label
  const chaptersInLang = feedChapters.filter((c) => c.translatedLanguage === language);
  const volumeToChapters = new Map<string, typeof chaptersInLang>();
  for (const ch of chaptersInLang) {
    const vol = ch.volume ?? "none";
    const existing = volumeToChapters.get(vol) ?? [];
    existing.push(ch);
    volumeToChapters.set(vol, existing);
  }

  const slug = toSlug(chosen.title, logger);

  // 6. Process each requested volume
  for (const volumeToken of requestedVolumes) {
    const volChapters = volumeToChapters.get(volumeToken);

    if (!volChapters || volChapters.length === 0) {
      logger.warn(
        { event: "download.volume_missing", context: "download", volume: volumeToken },
        `volume ${volumeToken} not found in feed; skipping`,
      );
      continue;
    }

    await processVolume(volumeToken, volChapters, chosen, slug, language, args, ctx, http);
  }
}
