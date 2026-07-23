import { downloadBundle as realDownloadBundle } from "../../downloader/index.ts";
import { MangakakalotParseError } from "../../integrations/mangakakalot/client/types.ts";
import type { CoverImage, PackedChapter } from "../../pack/index.ts";
import {
  buildVolumeFilename,
  fetchCover,
  packVolumeReplacingSources as realPackVolumeReplacingSources,
} from "../../pack/index.ts";
import type { Logger } from "../../plugins/logger/index.ts";
import type { SourceAdapter } from "../../sources/adapters/index.ts";
import type {
  BundleItem,
  Downloader,
  ExecuteDeps,
  ExecuteWalkthroughInput,
  ExecuteWalkthroughResult,
  Packer,
  ProgressHandle,
  RefreshSession,
} from "../types.ts";
import { WalkthroughError } from "../types.ts";
import { isCloudflareError, withSessionRetry } from "../with-session-retry.ts";

export type { ExecuteDeps, ExecuteWalkthroughInput, ExecuteWalkthroughResult } from "../types.ts";

/** Returns deps wired to real production modules (lazy import already resolved at module load). */
export function createDefaultExecuteDeps(): ExecuteDeps {
  return {
    downloader: { downloadBundle: realDownloadBundle },
    packer: { packVolumeReplacingSources: realPackVolumeReplacingSources },
  };
}

/** Derive a slug from a title — lowercase, alphanumeric + hyphens. */
function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Drops only the paths actually deleted; failed deletions stay in outputs (still exist). */
function removeDeletedFromOutputs(outputs: string[], deleted: string[]): void {
  for (const path of deleted) {
    const idx = outputs.indexOf(path);
    if (idx !== -1) outputs.splice(idx, 1);
  }
}

/** Fallback feedback (per-completed-page log) when the progress bar doesn't own stderr. */
function logPageProgressFallback(args: {
  progressEnabled: boolean;
  logger: Logger;
  pagesCompleted: number;
  totalPages: number;
  bundleId: string;
  bundleLabel: string;
}): void {
  const { progressEnabled, logger, pagesCompleted, totalPages, bundleId, bundleLabel } = args;
  if (progressEnabled) return;
  logger.info(
    {
      event: "walkthrough.fetch_page",
      context: "walkthrough",
      completed: pagesCompleted,
      total: totalPages,
      bundle_id: bundleId,
    },
    `fetched ${pagesCompleted}/${totalPages} pages of ${bundleLabel}`,
  );
}

/** Args for downloadOneBundle — everything one chapter fetch+download needs. */
interface DownloadOneBundleArgs {
  bundle: BundleItem;
  bundleIndex: number;
  slug: string;
  outDir: string;
  adapter: SourceAdapter;
  logger: Logger;
  progress?: ProgressHandle;
  progressEnabled: boolean;
  downloader: Downloader;
  outputs: string[];
  packedChapters: PackedChapter[];
}

/**
 * Fetches the chapter's page list from the adapter, downloads the bundle, and records
 * its output path + packed-chapter entry. Wrapped in withSessionRetry by the caller
 * when refreshFn is available, so a single CF rejection triggers one session refresh
 * + retry before the failure propagates.
 */
async function fetchAndDownloadBundle(args: DownloadOneBundleArgs): Promise<void> {
  const {
    bundle,
    bundleIndex,
    slug,
    outDir,
    adapter,
    logger,
    progress,
    progressEnabled,
    downloader,
    outputs,
    packedChapters,
  } = args;

  logger.info(
    {
      event: "walkthrough.download_start",
      context: "walkthrough",
      bundle_id: bundle.id,
      label: bundle.label,
    },
    `downloading ${bundle.label}`,
  );

  const chapterInput = await adapter.fetchChapterInput(bundle.id, bundle.num);
  const totalPages = chapterInput.pages.length;
  logger.info(
    {
      event: "walkthrough.download_page_done",
      context: "walkthrough",
      bundle_id: bundle.id,
      pages_count: totalPages,
    },
    `resolved ${totalPages} pages for ${bundle.label}`,
  );

  progress?.updateChapter(bundleIndex, totalPages, bundle.label);

  let pagesCompleted = 0;
  const result = await downloader.downloadBundle({
    outDir,
    format: "cbz",
    slug,
    kind: "chapter",
    bundleNumber: bundle.num.replace(/[^a-z0-9.]/gi, "-"),
    chapters: [chapterInput],
    imageConcurrency: 4,
    delayMs: 0,
    dryRun: false,
    logger,
    onPageCompleted: () => {
      progress?.updatePage();
      pagesCompleted++;
      logPageProgressFallback({
        progressEnabled,
        logger,
        pagesCompleted,
        totalPages,
        bundleId: bundle.id,
        bundleLabel: bundle.label,
      });
    },
  });

  outputs.push(result.outputPath);
  packedChapters.push({ num: bundle.num, outputPath: result.outputPath });

  logger.info(
    {
      event: "walkthrough.download_bundle_done",
      context: "walkthrough",
      bundle_id: bundle.id,
      output_path: result.outputPath,
    },
    `downloaded ${bundle.label}`,
  );
}

/** Args for downloadOneBundle's session-retry wrapping. */
interface DownloadOneBundleWithRetryArgs extends DownloadOneBundleArgs {
  refreshFn?: RefreshSession;
}

/** Runs fetchAndDownloadBundle, retried once via withSessionRetry when refreshFn is available. */
async function downloadOneBundle(args: DownloadOneBundleWithRetryArgs): Promise<void> {
  const { refreshFn, logger, ...bundleArgs } = args;
  const doBundle = () => fetchAndDownloadBundle({ ...bundleArgs, logger });

  if (refreshFn) {
    await withSessionRetry(
      doBundle,
      isCloudflareError,
      refreshFn,
      logger,
      "walkthrough.bundle_retry",
    );
  } else {
    await doBundle();
  }
}

/** Args for packSelectedVolume — everything the pack-and-replace-sources step needs. */
interface PackSelectedVolumeArgs {
  slug: string;
  outDir: string;
  coverUrl: string | null;
  volumeName?: string | null;
  packedChapters: PackedChapter[];
  outputs: string[];
  packer: Packer;
  logger: Logger;
}

/**
 * Fetches the cover (best-effort — packs without it on failure), then packs the volume
 * and deletes its per-chapter source files. Returns whether the pack itself failed, so
 * the caller can bump its failure counter without needing to catch here.
 */
async function packSelectedVolume(args: PackSelectedVolumeArgs): Promise<{ failed: boolean }> {
  const { slug, outDir, coverUrl, volumeName, packedChapters, outputs, packer, logger } = args;

  try {
    let cover: CoverImage | undefined;
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

    const customName = volumeName ? buildVolumeFilename(slug, volumeName) : undefined;

    // pack + delete-sources is one atomic call: source deletion is only reachable
    // after a successful write, and any deletion failure is best-effort — it never
    // fails the run.
    const { volume, deleted } = await packer.packVolumeReplacingSources({
      slug,
      outDir,
      chapters: packedChapters,
      cover,
      customName,
      logger,
    });

    logger.info(
      {
        event: "walkthrough.pack_done",
        context: "walkthrough",
        output_path: volume.outputPath,
        byte_size: volume.byteSize,
      },
      `packed volume: ${volume.outputPath}`,
    );

    removeDeletedFromOutputs(outputs, deleted);
    outputs.push(volume.outputPath);
    return { failed: false };
  } catch (err) {
    logger.warn(
      { event: "walkthrough.pack_failed", context: "walkthrough", err },
      "volume pack failed",
    );
    return { failed: true };
  }
}

/** Args for downloadAllBundles — the whole per-chapter download loop. */
interface DownloadAllBundlesArgs {
  selectedBundles: BundleItem[];
  slug: string;
  outDir: string;
  adapter: SourceAdapter;
  logger: Logger;
  refreshFn?: RefreshSession;
  progress?: ProgressHandle;
  progressEnabled: boolean;
  downloader: Downloader;
  outputs: string[];
  packedChapters: PackedChapter[];
}

/**
 * Downloads every selected bundle, tolerating per-bundle failures (counted, logged,
 * loop continues) but re-throwing systemic errors immediately: DOM drift
 * (MangakakalotParseError) would fail every remaining bundle identically, and a
 * WalkthroughError means CF survived a session refresh, so retrying more bundles
 * would fail the same way.
 * Returns the count of bundles that failed to download.
 */
async function downloadAllBundles(args: DownloadAllBundlesArgs): Promise<number> {
  const { selectedBundles, ...bundleArgs } = args;
  const { logger } = bundleArgs;
  let failed = 0;
  let bundleIndex = 0;

  for (const bundle of selectedBundles) {
    bundleIndex++;
    try {
      await downloadOneBundle({ ...bundleArgs, bundle, bundleIndex });
    } catch (err) {
      if (err instanceof MangakakalotParseError) throw err;
      if (err instanceof WalkthroughError) throw err;
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

  return failed;
}

/**
 * Step 9: execute the assembled plan — download each chapter, optionally pack into one
 * volume. The whole download loop runs inside a try/finally so `progress.finish()` (and
 * `endBar()` teardown) always run, even if the loop re-throws (MangakakalotParseError /
 * WalkthroughError) — otherwise a re-entrant iteration would inherit phantom stale bar
 * state from this aborted run.
 */
export async function executeWalkthrough(
  opts: ExecuteWalkthroughInput,
  deps: ExecuteDeps = createDefaultExecuteDeps(),
): Promise<ExecuteWalkthroughResult> {
  const {
    source,
    hit,
    selectedBundles,
    groupIntoVolume,
    volumeName,
    coverUrl,
    outDir,
    adapter,
    logger,
    refreshFn,
    progress,
    progressEnabled = false,
  } = opts;
  const { downloader, packer } = deps;

  const slug = toSlug(hit.title);
  const outputs: string[] = [];
  const packedChapters: PackedChapter[] = [];

  logger.info(
    {
      event: "walkthrough.execute_start",
      context: "walkthrough",
      source: source.id,
      slug,
      bundles: selectedBundles.length,
      groupIntoVolume,
    },
    "starting walkthrough execution",
  );

  let failed = 0;
  try {
    failed = await downloadAllBundles({
      selectedBundles,
      slug,
      outDir,
      adapter,
      logger,
      refreshFn,
      progress,
      progressEnabled,
      downloader,
      outputs,
      packedChapters,
    });

    if (groupIntoVolume && packedChapters.length > 0 && failed === 0) {
      const packResult = await packSelectedVolume({
        slug,
        outDir,
        coverUrl,
        volumeName,
        packedChapters,
        outputs,
        packer,
        logger,
      });
      if (packResult.failed) failed++;
    }
  } finally {
    progress?.finish();
  }

  return { outputs, failed };
}
