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
import type { SourceDescriptor } from "../../sources/types.ts";
import type { BundleItem, Downloader, Packer, ProgressHandle, SearchHit } from "../types.ts";
import { WalkthroughError } from "../types.ts";
import type { RefreshSession } from "../with-session-retry.ts";
import { isCloudflareError, withSessionRetry } from "../with-session-retry.ts";

export interface ExecuteWalkthroughInput {
  source: SourceDescriptor;
  hit: SearchHit;
  selectedBundles: BundleItem[];
  groupIntoVolume: boolean;
  /** Optional user-supplied volume number/name; null = auto-derive from chapter range. */
  volumeName?: string | null;
  coverUrl: string | null;
  outDir: string;
  adapter: SourceAdapter;
  logger: Logger;
  /**
   * Session refresh function threaded from the orchestrator.
   * Used to auto-refresh when fetchChapterInput hits a CF rejection.
   * When omitted, CF errors during execute are logged as bundle failures and skipped.
   */
  refreshFn?: RefreshSession;
  /** Optional stderr progress renderer; no-op handle when disabled/omitted. */
  progress?: ProgressHandle;
  /**
   * Whether the stderr progress bar is active (mirrors ProgressOptions.enabled).
   * Gates the per-page `walkthrough.fetch_page` log: when the bar owns stderr,
   * the per-page line is suppressed (bar is the feedback); when the bar is
   * disabled (non-TTY / no --progress) or in JSON mode, the per-page log is
   * the fallback feedback and stays on.
   * Defaults to false (per-page log kept) when omitted.
   */
  progressEnabled?: boolean;
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

/**
 * Step 9: execute the assembled plan — download each chapter, optionally pack into one
 * volume. The whole download loop runs inside a try/finally so `progress.finish()` (and
 * `endBar()` teardown) always run, even if the loop re-throws (MangakakalotParseError /
 * WalkthroughError) — otherwise a re-entrant iteration would inherit phantom stale bar
 * state from this aborted run.
 * Each bundle (fetch + download) is retried once on Cloudflare rejection when refreshFn
 * is available. DOM drift (MangakakalotParseError) is systemic — every remaining bundle
 * would fail the same way, so it aborts the loop immediately. Likewise, when CF survives
 * a refresh (WalkthroughError), subsequent bundles would fail identically, so it aborts.
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
  let failed = 0;
  let bundleIndex = 0;

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

  const packedChapters: PackedChapter[] = [];

  try {
    for (const bundle of selectedBundles) {
      bundleIndex++;
      try {
        const doBundle = async () => {
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
        };

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

    if (groupIntoVolume && packedChapters.length > 0 && failed === 0) {
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
      } catch (err) {
        failed++;
        logger.warn(
          { event: "walkthrough.pack_failed", context: "walkthrough", err },
          "volume pack failed",
        );
      }
    }
  } finally {
    progress?.finish();
  }

  return { outputs, failed };
}
