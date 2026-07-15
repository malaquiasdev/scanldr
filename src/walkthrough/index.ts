import { createFallbackHttp } from "../integrations/fallback-http/index.ts";
import type { Config } from "../plugins/config/index.ts";
import type { Logger } from "../plugins/logger/index.ts";
import type { SourceAdapter } from "../sources/adapters/index.ts";
import { getAdapter } from "../sources/adapters/index.ts";
import type { SourceDescriptor } from "../sources/types.ts";
import { createProgress } from "./progress.ts";
import { checkAuth, refreshSession } from "./steps/auth-check.ts";
import { promptCoverUrl } from "./steps/cover-prompt.ts";
import type { ExecuteDeps } from "./steps/execute.ts";
import { executeWalkthrough } from "./steps/execute.ts";
import { pickMode } from "./steps/mode-picker.ts";
import { promptNextAction } from "./steps/next-action-prompt.ts";
import { promptPack } from "./steps/pack-prompt.ts";
import { pickRange } from "./steps/range-picker.ts";
import { pickSearchResult } from "./steps/search-results-picker.ts";
import { pickSource } from "./steps/source-picker.ts";
import { promptTitle } from "./steps/title-prompt.ts";
import { promptVolumeName } from "./steps/volume-name-prompt.ts";
import type {
  ChapterListing,
  SearchHit,
  SessionProbeClientFactory,
  VolumeListing,
  WalkthroughCancelled,
  WalkthroughInput,
  WalkthroughResult,
} from "./types.ts";
import { WalkthroughError } from "./types.ts";
import { isCloudflareError, withSessionRetry } from "./with-session-retry.ts";

export type {
  SessionProbeClientFactory,
  WalkthroughCancelled,
  WalkthroughInput,
  WalkthroughResult,
} from "./types.ts";
export { WalkthroughError } from "./types.ts";

export interface RunWalkthroughOptions extends WalkthroughInput {
  logger: Logger;
  /** Output directory for downloads. Defaults to current working directory. */
  outDir?: string;
  /** User config — threaded into the adapter factory. */
  config?: Config;
  /** Override the XDG data home used to resolve the auth.json path (tests inject a tmp dir). */
  dataHome?: string;
  /** Override adapter factory (tests inject fakes). */
  adapterFactory?: (sourceId: string, opts: { logger: Logger; config?: Config }) => SourceAdapter;
  /** Override downloader/packer deps (tests inject fakes). */
  executeDeps?: ExecuteDeps;
  /**
   * Override the session probe client factory (tests inject fakes).
   * Production default: real fallback-http client created lazily after auth.json is written.
   * Pass null to disable probing (file-presence check only).
   */
  probeClientFactory?: SessionProbeClientFactory | null;
  /**
   * Override the refresh function for tests.
   * When provided, this is used instead of the real refreshSession for retry logic.
   */
  refreshFn?: () => Promise<void>;
  /**
   * Enables the stderr progress bar. Resolved by the CLI entrypoint as
   * `(process.stderr.isTTY || --progress) && !jsonMode`.
   * Defaults to false — callers that don't opt in get the previous log-only behavior.
   */
  progressEnabled?: boolean;
  /**
   * Bar-write seam of the shared stderr controller (see @plugins/terminal).
   * Threaded into `createProgress` so the bar and logger stay coordinated.
   * Defaults to raw stderr passthrough when omitted (e.g. direct test calls).
   */
  barWrite?: (chunk: string) => void;
  /**
   * Explicit bar-teardown seam of the shared stderr controller (see
   * @plugins/terminal). Threaded into `createProgress` so `finish()` resets
   * controller bar-state explicitly instead of relying on byte-sniffing.
   */
  endBar?: () => void;
}

/** Returned when walkthrough errors out in a handled way (WalkthroughError). */
export interface WalkthroughFailed {
  ok: false;
  reason: string;
}

/**
 * In-memory cache of listings already fetched for the current manga (hit),
 * so the "same manga" post-download branch never re-hits the adapter.
 */
interface ChapterListingCache {
  chapters: ChapterListing[] | null;
  volumes: VolumeListing[] | null;
}

/**
 * Composes all 9 walkthrough steps in order.
 * Returns the assembled plan + execution result on success.
 * Returns `{ cancelled: true }` when the user hits Ctrl+C.
 * Returns `{ ok: false, reason }` on WalkthroughError.
 */
export async function runWalkthrough(
  opts: RunWalkthroughOptions,
): Promise<WalkthroughResult | WalkthroughCancelled | WalkthroughFailed> {
  const resolveAdapter = opts.adapterFactory ?? getAdapter;
  const outDir = opts.outDir ?? process.cwd();

  try {
    // Step 2 — source (picked once per session; reused across "new manga" iterations)
    const source = await pickSource();

    // Step 3 — auth check (probe session when factory provided; production uses real fallback-http)
    const probeClientFactory: SessionProbeClientFactory | undefined =
      opts.probeClientFactory === null
        ? undefined
        : (opts.probeClientFactory ??
          ((): SessionProbeClientFactory => {
            // Default production factory: create a new fallback-http client each call so it
            // reads the auth.json that was just written by the paste prompt.
            return () => createFallbackHttp({ logger: opts.logger });
          })());
    await checkAuth({
      requiresAuth: source.requiresAuth,
      logger: opts.logger,
      probeClientFactory,
      dataHome: opts.dataHome,
    });

    // Build a refresh closure reused by all adapter-call retry wrappers.
    // In production this re-reads XDG auth path; in tests opts.refreshFn overrides.
    const doRefresh: () => Promise<void> = opts.refreshFn
      ? opts.refreshFn
      : probeClientFactory
        ? async () => {
            const { resolveAuthPath } = await import("../plugins/auth-path/index.ts");
            const authPath = resolveAuthPath();
            await refreshSession({ authPath, probeClientFactory, logger: opts.logger });
          }
        : async () => {
            // No probe factory — cannot refresh; surface as error
            throw new WalkthroughError(
              "Session expired but no probe factory is configured to refresh it.",
            );
          };

    // Resolve adapter for this source (after auth check so session is persisted if needed)
    const adapter = resolveAdapter(source.id, { logger: opts.logger, config: opts.config });

    let lastResult: WalkthroughResult | null = null;
    let hit: SearchHit | null = null;
    let cache: ChapterListingCache | null = null;

    // Post-auth/source loop: each iteration resolves a manga (search or reuse) and downloads.
    outer: for (;;) {
      // "New manga" entry point (also the first iteration): title + search.
      if (hit === null) {
        // Step 1 — title
        const title = await promptTitle();

        // Step 4 — search results (with CF retry)
        hit = await withSessionRetry(
          () =>
            pickSearchResult({
              query: title,
              sourceLabel: source.label,
              adapter,
            }),
          isCloudflareError,
          doRefresh,
          opts.logger,
          "walkthrough.search_retry",
        );
        cache = { chapters: null, volumes: null };

        lastResult = await runDownloadFlow({
          title,
          hit,
          cache,
          adapter,
          source,
          outDir,
          logger: opts.logger,
          doRefresh,
          executeDeps: opts.executeDeps,
          progressEnabled: opts.progressEnabled ?? false,
          barWrite: opts.barWrite,
          endBar: opts.endBar,
        });
      } else {
        // "Same manga" entry point: reuse hit + cached listings, re-enter at pickMode.
        if (cache === null) cache = { chapters: null, volumes: null };
        lastResult = await runDownloadFlow({
          title: lastResult?.title ?? "",
          hit,
          cache,
          adapter,
          source,
          outDir,
          logger: opts.logger,
          doRefresh,
          executeDeps: opts.executeDeps,
          progressEnabled: opts.progressEnabled ?? false,
          barWrite: opts.barWrite,
          endBar: opts.endBar,
        });
      }

      // Post-download: what next?
      const next = await promptNextAction();
      switch (next) {
        case "same-manga":
          continue outer;
        case "new-manga":
          hit = null;
          cache = null;
          continue outer;
        case "quit":
          break outer;
      }
    }

    if (!lastResult) {
      throw new WalkthroughError("Walkthrough ended without a completed download.");
    }
    return lastResult;
  } catch (err) {
    // @inquirer/prompts throws ExitPromptError when the user presses Ctrl+C
    if (err instanceof Error && err.name === "ExitPromptError") {
      return { cancelled: true };
    }
    if (err instanceof WalkthroughError) {
      opts.logger.warn(
        { event: "walkthrough.error", context: "walkthrough", reason: err.message },
        err.message,
      );
      return { ok: false, reason: err.message };
    }
    throw err;
  }
}

interface DownloadFlowOptions {
  title: string;
  hit: SearchHit;
  cache: ChapterListingCache;
  adapter: SourceAdapter;
  source: SourceDescriptor;
  outDir: string;
  logger: Logger;
  doRefresh: () => Promise<void>;
  executeDeps?: ExecuteDeps;
  progressEnabled: boolean;
  barWrite?: (chunk: string) => void;
  endBar?: () => void;
}

/**
 * Runs steps 5-9 (mode → range → pack prompts → execute) for an already-resolved
 * manga (hit). Reuses cached chapter/volume listings when present so "same manga"
 * iterations never re-call adapter.search or adapter.listChapters/listVolumes.
 */
async function runDownloadFlow(flowOpts: DownloadFlowOptions): Promise<WalkthroughResult> {
  const {
    title,
    hit,
    cache,
    adapter,
    source,
    outDir,
    logger,
    doRefresh,
    executeDeps,
    progressEnabled,
    barWrite,
    endBar,
  } = flowOpts;

  // Step 5 — mode
  const mode = await pickMode();

  // Step 6 — range (with CF retry). Reuse cached listing for this hit when available.
  const rangeResult = await withSessionRetry(
    () =>
      pickRange({
        hit,
        mode,
        adapter,
        preloadedChapters: mode === "chapter" ? (cache.chapters ?? undefined) : undefined,
        preloadedVolumes: mode === "volume" ? (cache.volumes ?? undefined) : undefined,
      }),
    isCloudflareError,
    doRefresh,
    logger,
    "walkthrough.range_retry",
  );
  const selectedBundles = rangeResult.bundles;

  // Cache the listing actually used (fetched or preloaded) for subsequent "same manga" iterations.
  if (rangeResult.chapters) cache.chapters = rangeResult.chapters;
  if (rangeResult.volumes) cache.volumes = rangeResult.volumes;

  // Step 7 — pack prompt (chapter mode only)
  // volume mode always packs
  const groupIntoVolume = mode === "volume" ? true : await promptPack();

  // Step 7b — volume name (chapter mode + groupIntoVolume only; volume mode uses bundle.num)
  const volumeName =
    mode === "chapter" && groupIntoVolume ? await promptVolumeName({ logger }) : null;

  // Step 8 — cover URL (only when packing)
  const coverUrl = groupIntoVolume ? await promptCoverUrl({ logger }) : null;

  const result: WalkthroughResult = {
    title,
    source,
    hit,
    mode,
    selectedBundles,
    groupIntoVolume,
    volumeName,
    coverUrl,
  };

  // Step 9 — execute (fetchChapterInput calls are wrapped inside executeWalkthrough).
  // A fresh progress handle is created per download flow iteration so the bar always
  // reflects this iteration's own bundle count, then finished before returning.
  const progress = createProgress({
    enabled: progressEnabled,
    totalChapters: selectedBundles.length,
    write: barWrite,
    endBar,
  });
  const { failed } = await executeWalkthrough(
    {
      source,
      hit,
      mode,
      selectedBundles,
      groupIntoVolume,
      volumeName,
      coverUrl,
      outDir,
      adapter,
      logger,
      refreshFn: doRefresh,
      progress,
      progressEnabled,
    },
    executeDeps,
  );

  // Partial failure is resilient: still return to the next-action prompt, but
  // surface a one-line summary so the user isn't left guessing.
  if (failed > 0) {
    logger.warn(
      {
        event: "walkthrough.download_summary_failed",
        context: "walkthrough",
        failed,
        total: selectedBundles.length,
      },
      `${failed} chapter(s) failed to download`,
    );
  }

  return result;
}
