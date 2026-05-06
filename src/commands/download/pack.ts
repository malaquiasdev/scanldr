import { rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { padBundleNumber } from "@modules/downloader/helpers.ts";
import { CliError } from "@plugins/errors/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import { unzipSync, zipSync } from "fflate";
import type { PackVolumeInput, PackVolumeResult, PackedChapter } from "./types.ts";

export type { PackedChapter, PackVolumeInput, PackVolumeResult };

/** Sort a chapter token numerically (decimal-aware). "none" sorts last. */
function chapterTokenToNum(token: string): number {
  if (token === "none") return Number.POSITIVE_INFINITY;
  const n = Number(token);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Build a volume filename from a user-supplied volume number/name stem.
 * Strips a trailing ".cbz" from input before applying the prefix.
 * e.g. buildVolumeFilename("dandadan", "13") → "dandadan-volume-13.cbz"
 *      buildVolumeFilename("dandadan", "13.cbz") → "dandadan-volume-13.cbz"
 *      buildVolumeFilename("dandadan", "special-edition") → "dandadan-volume-special-edition.cbz"
 */
export function buildVolumeFilename(slug: string, input: string): string {
  const clean = input.endsWith(".cbz") ? input.slice(0, -4) : input;
  return `${slug}-volume-${clean}.cbz`;
}

/**
 * Build the default volume filename stem.
 * e.g. slug="dandadan", chapters covering 103–111 → "dandadan-volume-103-111"
 */
export function defaultVolumeName(slug: string, chapters: PackedChapter[]): string {
  const sorted = [...chapters].sort((a, b) => chapterTokenToNum(a.num) - chapterTokenToNum(b.num));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return `${slug}-volume`;
  const firstPad = padBundleNumber(first.num, 3);
  const lastPad = padBundleNumber(last.num, 3);
  return firstPad === lastPad
    ? `${slug}-volume-${firstPad}`
    : `${slug}-volume-${firstPad}-${lastPad}`;
}

/**
 * Read one chapter cbz and return its entries namespaced under `chapter-<NNN>/`.
 * Pages are re-ordered by their numeric position (existing filenames may be 0001.jpg etc).
 */
async function readChapterEntries(
  chapterNum: string,
  cbzPath: string,
): Promise<Record<string, Uint8Array>> {
  const raw = await Bun.file(cbzPath).arrayBuffer();
  const entries = unzipSync(new Uint8Array(raw));

  // Sort by existing page filename numerically
  const names = Object.keys(entries).sort((a, b) => {
    const an = Number.parseInt(a.replace(/\D/g, ""), 10);
    const bn = Number.parseInt(b.replace(/\D/g, ""), 10);
    return an - bn;
  });

  const prefix = `chapter-${padBundleNumber(chapterNum, 3)}`;
  const result: Record<string, Uint8Array> = {};

  names.forEach((name, idx) => {
    const data = entries[name];
    if (!data) return;
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
    const newName = `${prefix}/page-${String(idx + 1).padStart(3, "0")}${ext}`;
    result[newName] = data;
  });

  return result;
}

/**
 * Pack multiple chapter cbz files into a single volume cbz.
 * Atomic write: write to .tmp first, then rename.
 */
export async function packVolume(input: PackVolumeInput): Promise<PackVolumeResult> {
  const { slug, outDir, chapters, customName, logger } = input;

  if (customName !== undefined) {
    // Reject names with path separators or '..' to prevent path traversal
    if (
      customName.includes("/") ||
      customName.includes("\\") ||
      customName.split(/[\\/]/).some((s) => s === "..")
    ) {
      throw new CliError(
        `--pack name cannot contain path separators or '..' (got: ${customName})`,
        2,
      );
    }
  }

  const sorted = [...chapters].sort((a, b) => chapterTokenToNum(a.num) - chapterTokenToNum(b.num));

  const stem = customName ?? defaultVolumeName(slug, sorted);
  const finalName = stem.endsWith(".cbz") ? stem : `${stem}.cbz`;
  const bundleDir = join(outDir, slug);
  const finalPath = join(bundleDir, finalName);
  const tempPath = `${finalPath}.tmp`;

  logger.info(
    {
      event: "pack.start",
      context: "pack",
      slug,
      chapterCount: sorted.length,
      outputPath: finalPath,
    },
    "packing volume cbz",
  );

  const allEntries: Record<string, Uint8Array> = {};

  for (const ch of sorted) {
    logger.info(
      { event: "pack.chapter_read", context: "pack", num: ch.num, path: ch.outputPath },
      `reading chapter ${ch.num}`,
    );
    const entries = await readChapterEntries(ch.num, ch.outputPath);
    Object.assign(allEntries, entries);
  }

  const zipped = zipSync(allEntries);
  try {
    await writeFile(tempPath, zipped, { mode: 0o644 });
    await rename(tempPath, finalPath);
  } catch (err) {
    // Clean up the temp file so it doesn't litter disk on partial writes.
    await unlink(tempPath).catch(() => undefined);
    throw err;
  }

  const { size } = await stat(finalPath);

  logger.info(
    { event: "pack.completed", context: "pack", outputPath: finalPath, byteSize: size },
    "volume cbz ready",
  );

  return { outputPath: finalPath, byteSize: size };
}

/** Delete individual chapter cbz files after packing. */
export async function deleteIndividualFiles(
  chapters: PackedChapter[],
  logger: Logger,
): Promise<void> {
  logger.info(
    { event: "pack.delete_individuals", context: "pack", count: chapters.length },
    "deleting individual chapter files",
  );
  let deleted = 0;
  let failed = 0;
  for (const ch of chapters) {
    try {
      await unlink(ch.outputPath);
      deleted++;
      logger.info(
        { event: "pack.deleted", context: "pack", path: ch.outputPath },
        `deleted ${ch.outputPath}`,
      );
    } catch (err) {
      failed++;
      logger.warn(
        {
          event: "pack.delete_failed",
          context: "pack",
          path: ch.outputPath,
          error: err instanceof Error ? err.message : String(err),
        },
        `failed to delete ${ch.outputPath}`,
      );
    }
  }
  logger.info(
    { event: "pack.delete_summary", context: "pack", deleted, failed },
    `deleted ${deleted} file(s), failed ${failed}`,
  );
}
