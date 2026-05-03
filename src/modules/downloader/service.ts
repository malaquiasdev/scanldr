import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";
import { detectExtFromBytes, extFromContentType, pad } from "./helpers.ts";
import { createSemaphore } from "./semaphore.ts";
import type {
  ChapterInput,
  DownloadVolumeInput,
  DownloadVolumeResult,
  ImageRef,
  Logger,
} from "./types.ts";

async function downloadChapterPages(
  chapter: ChapterInput,
  sem: ReturnType<typeof createSemaphore>,
  globalOffset: number,
  extState: { value: string; resolved: boolean },
  fetcher: (ref: ImageRef) => Promise<Uint8Array>,
  logger: Logger,
): Promise<Array<{ filename: string; data: Uint8Array }>> {
  const tasks = chapter.pages.map((ref, localIdx) => {
    const globalIdx = globalOffset + localIdx;
    return sem.run(async () => {
      logger.debug("fetching image", { chapterId: chapter.id, page: ref.page });
      const data = await fetcher(ref);
      if (!extState.resolved) {
        extState.resolved = true;
        extState.value = detectExtFromBytes(data) ?? extFromContentType(null);
      }
      return { globalIdx, data };
    });
  });

  const results = await Promise.all(tasks);
  return results.map(({ globalIdx, data }) => ({
    filename: `${pad(globalIdx + 1, 4)}${extState.value}`,
    data,
  }));
}

export async function downloadVolume(input: DownloadVolumeInput): Promise<DownloadVolumeResult> {
  const {
    outDir,
    format,
    slug,
    volumeNumber,
    chapters,
    imageConcurrency,
    delayMs,
    dryRun,
    logger,
    imageFetcher,
  } = input;

  const volumePad = pad(volumeNumber, 3);
  const ext = format === "zip" ? "zip" : "cbz";
  const filename = `${slug}-volume-${volumePad}.${ext}`;
  const volumeDir = join(outDir, slug);
  const finalPath = join(volumeDir, filename);
  const tempPath = `${finalPath}.temp`;
  const chapterIds = chapters.map((c) => c.id);
  const sorted = [...chapters].sort((a, b) => a.num - b.num);

  if (dryRun) {
    const totalPages = sorted.reduce((sum, c) => sum + c.pages.length, 0);
    logger.info("dry-run: would produce archive", {
      outputPath: finalPath,
      chapters: chapterIds.length,
      totalPages,
    });
    return { chapterIds, outputPath: `[dry-run] ${finalPath}`, byteSize: 0 };
  }

  await mkdir(volumeDir, { recursive: true });

  const sem = createSemaphore(imageConcurrency);
  const zipEntries: Record<string, Uint8Array> = {};
  const extState = { value: ".jpg", resolved: false };
  let globalOffset = 0;

  for (let i = 0; i < sorted.length; i++) {
    const chapter = sorted[i];
    if (!chapter) continue;
    logger.info("downloading chapter", { id: chapter.id, num: chapter.num });

    const pages = await downloadChapterPages(
      chapter,
      sem,
      globalOffset,
      extState,
      imageFetcher,
      logger,
    );
    for (const { filename: fname, data } of pages) {
      zipEntries[fname] = data;
    }

    globalOffset += chapter.pages.length;
    if (delayMs > 0 && i < sorted.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  logger.info("packing archive", { tempPath });
  const zipped = zipSync(zipEntries as Record<string, Uint8Array>);
  await writeFile(tempPath, zipped);
  await rename(tempPath, finalPath);
  logger.info("archive ready", { outputPath: finalPath });

  const { size } = await stat(finalPath);
  return { chapterIds, outputPath: finalPath, byteSize: size };
}
