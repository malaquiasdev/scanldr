import { createInterface } from "node:readline";
import {
  AtHomeError,
  getAtHomeServer,
  mangadexImageFetcher,
} from "@integrations/mangadex/at-home/index.ts";
import type { MangaDexClient } from "@integrations/mangadex/client/index.ts";
import type { MangaDexHttpClient } from "@integrations/mangadex/http/index.ts";
import { downloadVolume } from "@modules/downloader/index.ts";
import type { ChapterInput } from "@modules/downloader/types.ts";
import { isVolumeFullyDownloaded, recordDownloadedChapters } from "@modules/history/index.ts";
import type { DownloadRow } from "@modules/history/index.ts";
import { CliError } from "@plugins/errors/index.ts";
import { resolveLanguage } from "./language.ts";
import { parseRangeSet } from "./range.ts";
import type { DownloadArgs, DownloadContext } from "./types.ts";

export type { DownloadArgs, DownloadContext } from "./types.ts";

export { CliError } from "@plugins/errors/index.ts";

/** kebab-case a manga title for use as filesystem slug */
export function toSlug(
  title: string,
  logger?: { warn: (fields: Record<string, unknown>, msg: string) => void },
): string {
  const slug = title
    .normalize("NFKD")
    // Strip combining diacritical marks (e.g. accents) after NFKD decomposition
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug === "") {
    logger?.warn(
      { event: "download.slug_empty", context: "download", title },
      "title produced an empty slug; falling back to 'untitled'",
    );
    return "untitled";
  }

  return slug;
}

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

export async function runDownload(
  args: DownloadArgs,
  ctx: DownloadContext,
  client: MangaDexClient,
  http: MangaDexHttpClient,
): Promise<void> {
  const { logger, config, db } = ctx;

  // 1. Parse range
  const { values: requestedVolumes } = parseRangeSet(args.volume);

  // Fail immediately on --volume none (deferred feature)
  if (requestedVolumes.has("none")) {
    throw new CliError(
      "--volume none is not yet supported. Use a numeric volume number instead.",
      2,
    );
  }

  // 2. Resolve title to manga ID
  logger.info(
    { event: "download.search_start", context: "download", title: args.manga },
    "searching manga",
  );

  const candidates = await client.resolveTitleToId(args.manga);

  let chosenIndex = 0;
  if (candidates.length > 1) {
    if (args.nonTty) {
      const list = candidates.map((c, i) => `  [${i + 1}] ${c.title}`).join("\n");
      throw new CliError(
        `Multiple results found for "${args.manga}". Re-run in a terminal to pick one:\n${list}`,
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

  const preferred = config.preferred_languages;

  // 3. Aggregate volumes (early discovery — used to know which volumes exist)
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

  // Filter chapters to chosen language
  const chaptersInLang = feedChapters.filter((c) => c.translatedLanguage === language);

  // Build map: volume label → chapters
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
    // Find chapters for this volume
    const volChapters = volumeToChapters.get(volumeToken);

    if (!volChapters || volChapters.length === 0) {
      logger.warn(
        { event: "download.volume_missing", context: "download", volume: volumeToken },
        `volume ${volumeToken} not found in feed; skipping`,
      );
      continue;
    }

    const chapterIdSet = new Set(volChapters.map((c) => c.id));

    // 6a. History check
    if (!args.force) {
      const fullyDownloaded = isVolumeFullyDownloaded(db, {
        mangaId: chosen.id,
        volume: volumeToken,
        language,
        expectedChapterIds: chapterIdSet,
      });

      if (fullyDownloaded) {
        logger.info(
          {
            event: "download.volume_skip",
            context: "download",
            volume: volumeToken,
          },
          `skipping volume ${volumeToken}: already in history`,
        );
        continue;
      }
    }

    // 6b. External-chapter check
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

    // volumeNumber for downloader: parseRangeSet already validates numeric tokens
    const volumeNumber = Number(volumeToken);

    // 6c. Build ChapterInput[] — each chapter carries its own image fetcher
    const chapterInputs: ChapterInput[] = [];

    for (const ch of volChapters) {
      const server = await getAtHomeServer(http, ch.id, args.quality, logger);

      chapterInputs.push({
        id: ch.id,
        num: Number(ch.chapter ?? "0"),
        pages: server.pages.map((filename, i) => ({ url: filename, page: i + 1 })),
        imageFetcher: mangadexImageFetcher(ch.id, {
          httpClient: http,
          logger,
          quality: args.quality,
        }),
      });
    }

    // 6d–e. Download
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
      continue;
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

    // 6f. Record history
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
}
