// Downloader service — parallel fetch, CBZ packaging via fflate.
// See docs/overviewer.md §3.6 and docs/flows/download_flow.md.

import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@plugins/logger/index.ts";
import { zipSync } from "fflate";
import type { ChapterInput, DownloadVolumeInput, DownloadVolumeResult, ImageRef } from "./types.ts";

// ---------------------------------------------------------------------------
// Semaphore — hand-rolled, no p-limit
// ---------------------------------------------------------------------------

class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Zero-pad n to width digits. */
function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * Derive file extension from a Content-Type header value.
 * Falls back to ".jpg".
 */
export function extFromContentType(contentType: string | null | undefined): string {
  if (!contentType) return ".jpg";
  const ct = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (ct === "image/png") return ".png";
  if (ct === "image/jpeg" || ct === "image/jpg") return ".jpg";
  if (ct === "image/webp") return ".webp";
  if (ct === "image/gif") return ".gif";
  if (ct === "image/avif") return ".avif";
  return ".jpg";
}

/**
 * Download all pages of a single chapter in parallel (bounded by the semaphore).
 * Returns an array of { filename, data } entries sorted by page number.
 */
async function downloadChapterPages(
  chapter: ChapterInput,
  sem: Semaphore,
  globalOffset: number,
  ext: { value: string; resolved: boolean },
  fetcher: (ref: ImageRef) => Promise<Uint8Array>,
  log: ReturnType<typeof createLogger>,
): Promise<Array<{ filename: string; data: Uint8Array }>> {
  const tasks = chapter.pages.map((ref, localIdx) => {
    const globalIdx = globalOffset + localIdx;
    return sem.run(async () => {
      log.debug("fetching image", { chapterId: chapter.id, page: ref.page, url: ref.url });
      const data = await fetcher(ref);
      // Derive extension from first fetch (caller must embed Content-Type in a
      // header-bearing wrapper, or ext stays ".jpg" from the fallback).
      if (!ext.resolved) {
        ext.resolved = true;
        // Extension is set by the caller via imageFetcher contract; if the bytes
        // start with PNG magic we can detect it here as a convenience.
        if (data[0] === 0x89 && data[1] === 0x50) {
          ext.value = ".png";
        }
      }
      return { globalIdx, data };
    });
  });

  const results = await Promise.all(tasks);
  return results.map(({ globalIdx, data }) => ({
    filename: `${pad(globalIdx + 1, 4)}${ext.value}`,
    data,
  }));
}

// ---------------------------------------------------------------------------
// Public service function
// ---------------------------------------------------------------------------

export async function downloadVolume(input: DownloadVolumeInput): Promise<DownloadVolumeResult> {
  const log = createLogger({ level: "info", format: "human" });

  const {
    outDir,
    format,
    slug,
    volumeNumber,
    chapters,
    imageConcurrency,
    delayMs,
    dryRun,
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

  // --- dry-run path ---
  if (dryRun) {
    const totalPages = sorted.reduce((sum, c) => sum + c.pages.length, 0);
    log.info("dry-run: would produce archive", {
      outputPath: finalPath,
      chapters: chapterIds.length,
      totalPages,
    });
    return {
      chapterIds,
      outputPath: `[dry-run] ${finalPath}`,
      byteSize: 0,
    };
  }

  // --- real download path ---
  await mkdir(volumeDir, { recursive: true });

  const sem = new Semaphore(imageConcurrency);
  const zipEntries: Record<string, Uint8Array> = {};
  const extState = { value: ".jpg", resolved: false };
  let globalOffset = 0;

  for (let i = 0; i < sorted.length; i++) {
    const chapter = sorted[i];
    if (!chapter) continue;
    log.info("downloading chapter", { id: chapter.id, num: chapter.num });

    const pages = await downloadChapterPages(
      chapter,
      sem,
      globalOffset,
      extState,
      imageFetcher,
      log,
    );

    for (const { filename: fname, data } of pages) {
      zipEntries[fname] = data;
    }

    globalOffset += chapter.pages.length;

    if (delayMs > 0 && i < sorted.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // --- build archive ---
  log.info("packing archive", { tempPath });
  const entriesForFflate: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zipEntries)) {
    entriesForFflate[k] = v;
  }

  const zipped = zipSync(entriesForFflate);
  await writeFile(tempPath, zipped);

  // --- atomic rename: only after archive is fully written ---
  await rename(tempPath, finalPath);
  log.info("archive ready", { outputPath: finalPath });

  const { size } = await stat(finalPath);

  return {
    chapterIds,
    outputPath: finalPath,
    byteSize: size,
  };
}
