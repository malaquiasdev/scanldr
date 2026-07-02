import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChapterInput, ImageRef } from "@integrations/_shared/media.ts";
import { zipSync } from "fflate";
import { detectExtFromBytes, pad, padBundleNumber } from "./helpers.ts";
import { createSemaphore } from "./semaphore.ts";
import type { DownloadBundleInput, DownloadBundleResult, Semaphore } from "./types.ts";

async function fetchPage(
  ref: ImageRef,
  fetcher: (ref: ImageRef) => Promise<Uint8Array>,
  sem: Semaphore,
): Promise<{ data: Uint8Array; ext: string }> {
  return sem.run(async () => {
    const data = await fetcher(ref);
    const ext = detectExtFromBytes(data) ?? ".jpg";
    return { data, ext };
  });
}

async function fetchChapterPages(
  chapter: ChapterInput,
  sem: Semaphore,
  globalOffset: number,
): Promise<Array<{ filename: string; data: Uint8Array }>> {
  const tasks = chapter.pages.map((ref, localIdx) => {
    const globalIdx = globalOffset + localIdx;
    return fetchPage(ref, chapter.imageFetcher, sem).then(({ data, ext }) => ({
      filename: `${pad(globalIdx + 1, 4)}${ext}`,
      data,
    }));
  });
  return Promise.all(tasks);
}

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
  let globalOffset = 0;

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

    const pages = await fetchChapterPages(chapter, sem, globalOffset);
    for (const { filename: fname, data } of pages) {
      zipEntries[fname] = data;
    }

    globalOffset += chapter.pages.length;
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
