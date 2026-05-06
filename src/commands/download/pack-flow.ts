import { access } from "node:fs/promises";
import { join } from "node:path";
import { defaultVolumeName, deleteIndividualFiles, packVolume } from "./pack.ts";
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

  const stem = customName ?? defaultVolumeName(slug, successPaths);
  const finalName = stem.endsWith(".cbz") ? stem : `${stem}.cbz`;
  const targetPath = join(args.outDir, slug, finalName);

  let fileExists = false;
  try {
    await access(targetPath);
    fileExists = true;
  } catch {
    fileExists = false;
  }

  const { shouldPack, shouldDelete } = await runPackPrompts({
    chapterCount: successPaths.length,
    outputName: finalName,
    fileExists,
    nonTty: args.nonTty,
    packFlag,
    packReplace: args.packReplace,
    packOverwrite: args.packOverwrite,
    logger,
  });

  if (!shouldPack) return;

  const result = await packVolume({
    slug,
    outDir: args.outDir,
    chapters: successPaths,
    customName,
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
