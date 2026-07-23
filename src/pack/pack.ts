import { stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { CliError } from "@plugins/errors/index.ts";
import { atomicWrite } from "@plugins/fs-atomic/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import { unzipSync, zipSync } from "fflate";
import { isNoneToken, padBundleNumber } from "../downloader/helpers.ts";
import type {
  PackedChapter,
  PackVolumeInput,
  PackVolumeReplacingSourcesResult,
  PackVolumeResult,
} from "./types.ts";

export type { PackedChapter, PackVolumeInput, PackVolumeReplacingSourcesResult, PackVolumeResult };

function isUnsafeVolumeName(name: string): boolean {
  return name.includes("/") || name.includes("\\") || name.split(/[\\/]/).some((s) => s === "..");
}

/**
 * Sort a chapter token numerically (decimal-aware). "none" (and disambiguated
 * "none-<n>" variants) sorts last, and mutually stable relative to each other
 * (Array.prototype.sort is stable, so equal keys preserve source order).
 */
function chapterTokenToNum(token: string): number {
  if (isNoneToken(token)) return Number.POSITIVE_INFINITY;
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
  const names = sortEntryNamesByPageNumber(Object.keys(entries));

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

function sortEntryNamesByPageNumber(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const an = Number.parseInt(a.replace(/\D/g, ""), 10);
    const bn = Number.parseInt(b.replace(/\D/g, ""), 10);
    return an - bn;
  });
}

/**
 * Pack multiple chapter cbz files into a single volume cbz.
 * Atomic write: write to .tmp first, then rename.
 *
 * If a cover is provided, "00_cover" sorts before "chapter-" so readers using the
 * first zip entry as thumbnail get the cover.
 */
export async function packVolume(input: PackVolumeInput): Promise<PackVolumeResult> {
  const { slug, outDir, chapters, customName, logger } = input;

  if (customName !== undefined && isUnsafeVolumeName(customName)) {
    throw new CliError(
      `volume name cannot contain path separators or '..' (got: ${customName})`,
      2,
    );
  }

  const sorted = [...chapters].sort((a, b) => chapterTokenToNum(a.num) - chapterTokenToNum(b.num));

  const stem = customName ?? defaultVolumeName(slug, sorted);
  const finalName = stem.endsWith(".cbz") ? stem : `${stem}.cbz`;
  const bundleDir = join(outDir, slug);
  const finalPath = join(bundleDir, finalName);

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

  if (input.cover) {
    const coverName = `00_cover${input.cover.ext}`;
    allEntries[coverName] = input.cover.bytes;
    logger.info(
      {
        event: "pack.cover_added",
        context: "pack",
        file: coverName,
        bytes: input.cover.bytes.byteLength,
      },
      "cover image added",
    );
  }

  for (const ch of sorted) {
    logger.info(
      { event: "pack.chapter_read", context: "pack", num: ch.num, path: ch.outputPath },
      `reading chapter ${ch.num}`,
    );
    const entries = await readChapterEntries(ch.num, ch.outputPath);
    for (const name of Object.keys(entries)) {
      if (name in allEntries) {
        throw new CliError(
          `pack: duplicate zip entry "${name}" while packing chapter "${ch.num}" — ` +
            "two chapters produced the same zip prefix (numbering collision upstream, e.g. " +
            "duplicate 'none' sentinels); aborting to avoid silently overwriting the first " +
            "chapter's pages",
          1,
        );
      }
    }
    Object.assign(allEntries, entries);
  }

  const zipped = zipSync(allEntries);
  await atomicWrite(finalPath, zipped, { mode: 0o644 });

  const { size } = await stat(finalPath);

  logger.info(
    { event: "pack.completed", context: "pack", outputPath: finalPath, byteSize: size },
    "volume cbz ready",
  );

  return { outputPath: finalPath, byteSize: size };
}

/**
 * Pack a volume, then delete its source per-chapter cbz files — in that order,
 * structurally. deleteIndividualFiles is never reachable before packVolume
 * resolves, so a caller cannot lose source files on a failed pack: if
 * packVolume throws, this function throws too and nothing is deleted.
 */
export async function packVolumeReplacingSources(
  input: PackVolumeInput,
): Promise<PackVolumeReplacingSourcesResult> {
  const volume = await packVolume(input);
  const deleted = await deleteIndividualFiles(input.chapters, input.logger);
  return { volume, deleted };
}

/** Delete individual chapter cbz files after packing. */
async function deleteIndividualFiles(chapters: PackedChapter[], logger: Logger): Promise<string[]> {
  logger.info(
    { event: "pack.delete_individuals", context: "pack", count: chapters.length },
    "deleting individual chapter files",
  );
  const deletedPaths: string[] = [];
  let failed = 0;
  for (const ch of chapters) {
    try {
      await unlink(ch.outputPath);
      deletedPaths.push(ch.outputPath);
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
    { event: "pack.delete_summary", context: "pack", deleted: deletedPaths.length, failed },
    `deleted ${deletedPaths.length} file(s), failed ${failed}`,
  );
  return deletedPaths;
}
