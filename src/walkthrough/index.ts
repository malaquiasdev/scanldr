import { createFallbackHttp } from "../integrations/fallback-http/index.ts";
import type { Logger } from "../plugins/logger/index.ts";
import type { SourceAdapter } from "../sources/adapters/index.ts";
import { getAdapter } from "../sources/adapters/index.ts";
import { checkAuth, refreshSession } from "./steps/auth-check.ts";
import { promptCoverUrl } from "./steps/cover-prompt.ts";
import type { ExecuteDeps } from "./steps/execute.ts";
import { executeWalkthrough } from "./steps/execute.ts";
import { pickMode } from "./steps/mode-picker.ts";
import { promptPack } from "./steps/pack-prompt.ts";
import { pickRange } from "./steps/range-picker.ts";
import { pickSearchResult } from "./steps/search-results-picker.ts";
import { pickSource } from "./steps/source-picker.ts";
import { promptTitle } from "./steps/title-prompt.ts";
import { promptVolumeName } from "./steps/volume-name-prompt.ts";
import type {
  SessionProbeClientFactory,
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
  /** Override adapter factory (tests inject fakes). */
  adapterFactory?: (sourceId: string, opts: { logger: Logger }) => SourceAdapter;
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
}

/** Returned when walkthrough errors out in a handled way (WalkthroughError). */
export interface WalkthroughFailed {
  ok: false;
  reason: string;
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
    // Step 1 — title
    const title = await promptTitle();

    // Step 2 — source
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
    const adapter = resolveAdapter(source.id, { logger: opts.logger });

    // Step 4 — search results (with CF retry)
    const hit = await withSessionRetry(
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

    // Step 5 — mode
    const mode = await pickMode();

    // Step 6 — range (with CF retry)
    const selectedBundles = await withSessionRetry(
      () => pickRange({ hit, mode, adapter }),
      isCloudflareError,
      doRefresh,
      opts.logger,
      "walkthrough.range_retry",
    );

    // Step 7 — pack prompt (chapter mode only)
    // volume mode always packs
    const groupIntoVolume = mode === "volume" ? true : await promptPack();

    // Step 7b — volume name (chapter mode + groupIntoVolume only; volume mode uses bundle.num)
    const volumeName =
      mode === "chapter" && groupIntoVolume
        ? await promptVolumeName({ logger: opts.logger })
        : null;

    // Step 8 — cover URL (only when packing)
    const coverUrl = groupIntoVolume ? await promptCoverUrl({ logger: opts.logger }) : null;

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

    // Step 9 — execute (fetchChapterInput calls are wrapped inside executeWalkthrough)
    await executeWalkthrough(
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
        logger: opts.logger,
        refreshFn: doRefresh,
      },
      opts.executeDeps,
    );

    return result;
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
