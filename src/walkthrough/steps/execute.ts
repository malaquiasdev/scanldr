import { fetchCover } from "../../commands/download/cover.ts";
import { packVolume as realPackVolume } from "../../commands/download/pack.ts";
import type { PackedChapter } from "../../commands/download/pack.ts";
import { downloadBundle as realDownloadBundle } from "../../modules/downloader/index.ts";
import type { Logger } from "../../plugins/logger/index.ts";
import type { SourceAdapter } from "../../sources/adapters/index.ts";
import type { SourceDescriptor } from "../../sources/types.ts";
import type { BundleItem, Downloader, ModeSelection, Packer, SearchHit } from "../types.ts";

export interface ExecuteWalkthroughInput {
  source: SourceDescriptor;
  hit: SearchHit;
  mode: ModeSelection;
  selectedBundles: BundleItem[];
  groupIntoVolume: boolean;
  coverUrl: string | null;
  outDir: string;
  adapter: SourceAdapter;
  logger: Logger;
}

export interface ExecuteDeps {
  downloader: Downloader;
  packer: Packer;
}

export interface ExecuteWalkthroughResult {
  outputs: string[];
  failed: number;
}

/** Returns deps wired to real production modules (lazy import already resolved at module load). */
export function createDefaultExecuteDeps(): ExecuteDeps {
  return {
    downloader: { downloadBundle: realDownloadBundle },
    packer: { packVolume: realPackVolume },
  };
}

/** Derive a slug from a title — lowercase, alphanumeric + hyphens. */
function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Step 9: execute the assembled plan — download pages + pack when requested. */
export async function executeWalkthrough(
  opts: ExecuteWalkthroughInput,
  deps: ExecuteDeps = createDefaultExecuteDeps(),
): Promise<ExecuteWalkthroughResult> {
  const { source, hit, mode, selectedBundles, groupIntoVolume, coverUrl, outDir, adapter, logger } =
    opts;
  const { downloader, packer } = deps;

  const slug = toSlug(hit.title);
  const outputs: string[] = [];
  let failed = 0;

  logger.info(
    {
      event: "walkthrough.execute_start",
      context: "walkthrough",
      source: source.id,
      slug,
      mode,
      bundles: selectedBundles.length,
      groupIntoVolume,
    },
    "starting walkthrough execution",
  );

  const packedChapters: PackedChapter[] = [];

  for (const bundle of selectedBundles) {
    try {
      logger.info(
        {
          event: "walkthrough.download_start",
          context: "walkthrough",
          bundle_id: bundle.id,
          label: bundle.label,
        },
        `downloading ${bundle.label}`,
      );

      const chapterInput = await adapter.fetchChapterInput(bundle.id);

      logger.info(
        {
          event: "walkthrough.download_page_done",
          context: "walkthrough",
          bundle_id: bundle.id,
          pages_count: chapterInput.pages.length,
        },
        `resolved ${chapterInput.pages.length} pages for ${bundle.label}`,
      );

      const result = await downloader.downloadBundle({
        outDir,
        format: "cbz",
        slug,
        kind: mode === "volume" ? "volume" : "chapter",
        bundleNumber: bundle.id.replace(/[^a-z0-9.]/gi, "-"),
        chapters: [chapterInput],
        imageConcurrency: 4,
        delayMs: 0,
        dryRun: false,
        logger,
      });

      outputs.push(result.outputPath);
      packedChapters.push({ num: bundle.id, outputPath: result.outputPath });

      logger.info(
        {
          event: "walkthrough.download_bundle_done",
          context: "walkthrough",
          bundle_id: bundle.id,
          output_path: result.outputPath,
        },
        `downloaded ${bundle.label}`,
      );
    } catch (err) {
      failed++;
      logger.warn(
        {
          event: "walkthrough.download_bundle_failed",
          context: "walkthrough",
          bundle_id: bundle.id,
          err,
        },
        `failed to download ${bundle.label}; continuing`,
      );
    }
  }

  if (groupIntoVolume && packedChapters.length > 0 && failed === 0) {
    try {
      let cover: { bytes: Uint8Array; ext: string } | undefined;
      if (coverUrl !== null) {
        try {
          cover = await fetchCover(coverUrl);
        } catch (err) {
          logger.warn(
            { event: "walkthrough.cover_fetch_failed", context: "walkthrough", coverUrl, err },
            "cover fetch failed; packing without cover",
          );
        }
      }

      const packResult = await packer.packVolume({
        slug,
        outDir,
        chapters: packedChapters,
        cover,
        logger,
      });

      logger.info(
        {
          event: "walkthrough.pack_done",
          context: "walkthrough",
          output_path: packResult.outputPath,
          byte_size: packResult.byteSize,
        },
        `packed volume: ${packResult.outputPath}`,
      );

      outputs.push(packResult.outputPath);
    } catch (err) {
      failed++;
      logger.warn(
        { event: "walkthrough.pack_failed", context: "walkthrough", err },
        "volume pack failed",
      );
    }
  }

  return { outputs, failed };
}
