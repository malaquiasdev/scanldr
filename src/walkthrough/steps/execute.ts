import { downloadBundle as realDownloadBundle } from "../../downloader/index.ts";
import { MangakakalotParseError } from "../../integrations/mangakakalot/client/types.ts";
import type { Logger } from "../../plugins/logger/index.ts";
import type { SourceAdapter } from "../../sources/adapters/index.ts";
import type { SourceDescriptor } from "../../sources/types.ts";
import type { BundleItem, Downloader, ProgressHandle, SearchHit } from "../types.ts";
import { WalkthroughError } from "../types.ts";
import type { RefreshSession } from "../with-session-retry.ts";
import { isCloudflareError, withSessionRetry } from "../with-session-retry.ts";

export interface ExecuteWalkthroughInput {
  source: SourceDescriptor;
  hit: SearchHit;
  selectedBundles: BundleItem[];
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
}

export interface ExecuteWalkthroughResult {
  outputs: string[];
  failed: number;
}

/** Returns deps wired to real production modules (lazy import already resolved at module load). */
export function createDefaultExecuteDeps(): ExecuteDeps {
  return {
    downloader: { downloadBundle: realDownloadBundle },
  };
}

/** Derive a slug from a title — lowercase, alphanumeric + hyphens. */
function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Step 9: execute the assembled plan — download each chapter as its own .cbz. */
export async function executeWalkthrough(
  opts: ExecuteWalkthroughInput,
  deps: ExecuteDeps = createDefaultExecuteDeps(),
): Promise<ExecuteWalkthroughResult> {
  const {
    source,
    hit,
    selectedBundles,
    outDir,
    adapter,
    logger,
    refreshFn,
    progress,
    progressEnabled = false,
  } = opts;
  const { downloader } = deps;

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
    },
    "starting walkthrough execution",
  );

  // The bundle loop can re-throw (MangakakalotParseError / WalkthroughError) to abort
  // the whole walkthrough early. Wrapping everything in try/finally guarantees
  // progress.finish() (and thus the shared stderr controller's endBar() teardown)
  // still runs on that error path, so a re-entrant post-download-loop iteration never
  // inherits phantom stale bar state from this aborted run.
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

          // Same "count completions, not dispatch order" rule as the progress bar
          // (pages resolve out of order under concurrency): this is a completion
          // counter, not a page index/ordinal — under concurrency it does NOT
          // correspond to "page N of the chapter".
          let pagesFetched = 0;
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
            onPageProgress: () => {
              progress?.updatePage();
              pagesFetched++;
              // Per-page terminal log — moved here from the mangakakalot adapter (#171):
              // it's the same signal as the progress bar, so exactly one may own stderr.
              // Suppressed when the bar is enabled (bar is the feedback); kept as the
              // long-running-fetch fallback otherwise (non-TTY / no --progress / json mode).
              // NOTE trace-store consequence: in interactive/TTY runs (bar enabled) these
              // per-page rows are absent from the trace; chapter-level rows are unaffected.
              if (!progressEnabled) {
                logger.info(
                  {
                    event: "walkthrough.fetch_page",
                    context: "walkthrough",
                    completed: pagesFetched,
                    total: totalPages,
                    bundle_id: bundle.id,
                  },
                  `fetched ${pagesFetched}/${totalPages} pages of ${bundle.label}`,
                );
              }
            },
          });

          outputs.push(result.outputPath);

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

        // Wrap the entire per-bundle work (fetchChapterInput + downloadBundle) in a single
        // withSessionRetry call when refreshFn is available. Any CloudflareError raised during
        // metadata fetch OR page downloads triggers one session refresh and retries the whole bundle.
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
        // DOM drift (MangakakalotParseError) is a systemic failure — site layout changed.
        // Every remaining bundle will fail the same way, so abort immediately.
        if (err instanceof MangakakalotParseError) throw err;
        // CF survived refresh → WalkthroughError thrown by withSessionRetry.
        // Subsequent bundles would fail the same way; abort the entire walkthrough.
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
  } finally {
    progress?.finish();
  }

  return { outputs, failed };
}
