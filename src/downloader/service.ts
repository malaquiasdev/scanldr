import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChapterInput, ImageRef } from "@integrations/_shared/media.ts";
import { zipSync } from "fflate";
import { detectExtFromBytes, pad, padBundleNumber } from "./helpers.ts";
import { reassembleChapterPages } from "./reassemble.ts";
import { createSemaphore } from "./semaphore.ts";
import type { DownloadBundleInput, DownloadBundleResult, RawPage, Semaphore } from "./types.ts";

async function fetchPage(
  ref: ImageRef,
  fetcher: (ref: ImageRef) => Promise<Uint8Array>,
  sem: Semaphore,
): Promise<RawPage> {
  return sem.run(async () => {
    const data = await fetcher(ref);
    const ext = detectExtFromBytes(data) ?? ".jpg";
    return { data, ext };
  });
}

/**
 * Fetches one chapter's raw pages, in reader order. Filenames are NOT assigned here —
 * CDN-tiled pages may still need to be merged (see reassemble.ts) before the final page
 * count (and therefore filenames) is known. Progress is still reported per fetched tile,
 * since that's a download signal, not an emitted-page signal.
 */
async function fetchChapterPages(
  chapter: ChapterInput,
  sem: Semaphore,
  totalPages: number,
  onPageCompleted?: (totalPages: number) => void,
): Promise<RawPage[]> {
  const tasks = chapter.pages.map((ref) =>
    fetchPage(ref, chapter.imageFetcher, sem).then((page) => {
      onPageCompleted?.(totalPages);
      return page;
    }),
  );
  return Promise.all(tasks);
}

/**
 * emittedPageCount tracks the post-merge page count (not the fetched-tile count), so
 * zip filenames stay contiguous even when CDN-tiled pages get merged into fewer pages.
 */
export async function downloadBundle(input: DownloadBundleInput): Promise<DownloadBundleResult> {
  const {
    outDir,
    format,
    slug,
    kind,
    bundleNumber,
    chapters,
    imageConcurrency,
    delayMs,
    dryRun,
    logger,
    onPageCompleted,
  } = input;

  const padded = padBundleNumber(bundleNumber, 3);
  const ext = format === "zip" ? "zip" : "cbz";
  const filename = `${slug}-${kind}-${padded}.${ext}`;
  const bundleDir = join(outDir, slug);
  const finalPath = join(bundleDir, filename);
  const tempPath = `${finalPath}.temp`;
  const chapterIds = chapters.map((c) => c.id);
  const sorted = [...chapters].sort((a, b) => a.num - b.num);

  if (dryRun) {
    const totalPages = sorted.reduce((sum, c) => sum + c.pages.length, 0);
    logger.info(
      {
        event: "downloader.dry_run",
        context: "downloader",
        outputPath: finalPath,
        chapters: chapterIds.length,
        totalPages,
      },
      "dry-run: would produce archive",
    );
    return { chapterIds, outputPath: `[dry-run] ${finalPath}`, byteSize: 0 };
  }

  await mkdir(bundleDir, { recursive: true });

  const sem = createSemaphore(imageConcurrency);
  const zipEntries: Record<string, Uint8Array> = {};
  let emittedPageCount = 0;
  const totalPages = sorted.reduce((sum, c) => sum + c.pages.length, 0);

  for (let i = 0; i < sorted.length; i++) {
    const chapter = sorted[i];
    if (!chapter) continue;
    logger.info(
      {
        event: "downloader.chapter_start",
        context: "downloader",
        id: chapter.id,
        num: chapter.num,
      },
      "downloading chapter",
    );

    const rawPages = await fetchChapterPages(chapter, sem, totalPages, onPageCompleted);
    const mergedPages = await reassembleChapterPages(rawPages, logger);

    if (mergedPages.length < rawPages.length) {
      logger.info(
        {
          event: "downloader.tiles_reassembled",
          context: "downloader",
          id: chapter.id,
          num: chapter.num,
          fetchedTiles: rawPages.length,
          emittedPages: mergedPages.length,
        },
        "merged CDN-tiled pages into logical pages",
      );
    }

    for (const { data, ext } of mergedPages) {
      emittedPageCount++;
      zipEntries[`${pad(emittedPageCount, 4)}${ext}`] = data;
    }

    if (delayMs > 0 && i < sorted.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  logger.info(
    { event: "downloader.pack_start", context: "downloader", tempPath },
    "packing archive",
  );
  const zipped = zipSync(zipEntries);
  await writeFile(tempPath, zipped);
  await rename(tempPath, finalPath);
  logger.info(
    { event: "downloader.pack_done", context: "downloader", outputPath: finalPath },
    "archive ready",
  );

  const { size } = await stat(finalPath);
  return { chapterIds, outputPath: finalPath, byteSize: size };
}
