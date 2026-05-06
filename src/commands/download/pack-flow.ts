import { access } from "node:fs/promises";
import { join } from "node:path";
import { buildVolumeFilename, defaultVolumeName, deleteIndividualFiles, packVolume } from "./pack.ts";
import type { PackedChapter } from "./pack.ts";
import { runPackPrompts } from "./prompt-pack.ts";
import type { DownloadArgs, DownloadContext } from "./types.ts";

export type { PackedChapter } from "./pack.ts";

/** Determine the output filename stem for the pack, then run prompts + pack. */
export async function runPackFlow(opts: {
  args: DownloadArgs;
  ctx: DownloadContext;
  slug: string;
  successPaths: PackedChapter[];
}): Promise<void> {
  const { args, ctx, slug, successPaths } = opts;
  const { logger } = ctx;

  // --pack-replace implies --pack
  const packFlag = args.packReplace || args.pack !== undefined;
  const customName = typeof args.pack === "string" && args.pack !== "" ? args.pack : undefined;
  const packNameProvided = customName !== undefined;

  const stem = customName ?? defaultVolumeName(slug, successPaths);
  const finalName = stem.endsWith(".cbz") ? stem : `${stem}.cbz`;

  // Extract the portion after "<slug>-volume-" to use as the hint in the prompt.
  // e.g. stem = "dandadan-volume-103-111" → hint = "103-111"
  const volumePrefix = `${slug}-volume-`;
  const defaultVolumeStem = stem.startsWith(volumePrefix) ? stem.slice(volumePrefix.length) : stem;

  const { shouldPack, shouldDelete, volumeName, cover } = await runPackPrompts({
    chapterCount: successPaths.length,
    slug,
    outputName: finalName,
    defaultVolumeStem,
    checkExists: async (filename: string) => {
      try {
        await access(join(args.outDir, slug, filename));
        return true;
      } catch {
        return false;
      }
    },
    nonTty: args.nonTty,
    packFlag,
    packNameProvided,
    packReplace: args.packReplace,
    packOverwrite: args.packOverwrite,
    coverUrl: args.coverUrl,
    logger,
  });

  if (!shouldPack) return;

  // Resolve the effective custom name.
  // Prompt input is a volume-number suffix → apply "<slug>-volume-<input>" convention.
  // --pack <name> flag input is already a complete filename stem → pass through as-is.
  const resolvedCustomName =
    volumeName !== undefined ? buildVolumeFilename(slug, volumeName) : customName;

  const result = await packVolume({
    slug,
    outDir: args.outDir,
    chapters: successPaths,
    customName: resolvedCustomName,
    cover,
    logger,
  });

  const mb = (result.byteSize / 1024 / 1024).toFixed(1);
  process.stderr.write(`✓ Created ${result.outputPath} (${mb} MB)\n`);

  if (shouldDelete) {
    await deleteIndividualFiles(successPaths, logger);
    process.stderr.write(`✓ Deleted ${successPaths.length} individual chapter files\n`);
  } else {
    process.stderr.write(`✓ Kept ${successPaths.length} individual chapter files\n`);
  }
}
