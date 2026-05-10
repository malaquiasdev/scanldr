import type { Logger } from "../plugins/logger/index.ts";
import type { SourceAdapter } from "../sources/adapters/index.ts";
import { getAdapter } from "../sources/adapters/index.ts";
import { checkAuth } from "./steps/auth-check.ts";
import { promptCoverUrl } from "./steps/cover-prompt.ts";
import { executeWalkthrough } from "./steps/execute.ts";
import { pickMode } from "./steps/mode-picker.ts";
import { promptPack } from "./steps/pack-prompt.ts";
import { pickRange } from "./steps/range-picker.ts";
import { pickSearchResult } from "./steps/search-results-picker.ts";
import { pickSource } from "./steps/source-picker.ts";
import { promptTitle } from "./steps/title-prompt.ts";
import type { WalkthroughCancelled, WalkthroughInput, WalkthroughResult } from "./types.ts";
import { WalkthroughError } from "./types.ts";

export type { WalkthroughCancelled, WalkthroughInput, WalkthroughResult } from "./types.ts";
export { WalkthroughError } from "./types.ts";

export interface RunWalkthroughOptions extends WalkthroughInput {
  logger: Logger;
  /** Output directory for downloads. Defaults to current working directory. */
  outDir?: string;
  /** Override adapter factory (tests inject fakes). */
  adapterFactory?: (sourceId: string, opts: { logger: Logger }) => SourceAdapter;
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
    const title = await promptTitle({ prefill: opts.titlePrefill });

    // Step 2 — source
    const source = await pickSource();

    // Step 3 — auth check
    await checkAuth({ requiresAuth: source.requiresAuth, logger: opts.logger });

    // Resolve adapter for this source (after auth check so session is persisted if needed)
    const adapter = resolveAdapter(source.id, { logger: opts.logger });

    // Step 4 — search results
    const hit = await pickSearchResult({
      query: title,
      sourceLabel: source.label,
      adapter,
    });

    // Step 5 — mode
    const mode = await pickMode();

    // Step 6 — range
    const selectedBundles = await pickRange({ hit, mode, adapter });

    // Step 7 — pack prompt (chapter mode only)
    // volume mode always packs
    const groupIntoVolume = mode === "volume" ? true : await promptPack();

    // Step 8 — cover URL (only when packing)
    const coverUrl = groupIntoVolume ? await promptCoverUrl({ logger: opts.logger }) : null;

    const result: WalkthroughResult = {
      title,
      source,
      hit,
      mode,
      selectedBundles,
      groupIntoVolume,
      coverUrl,
    };

    // Step 9 — execute
    await executeWalkthrough({
      source,
      hit,
      mode,
      selectedBundles,
      groupIntoVolume,
      coverUrl,
      outDir,
      adapter,
      logger: opts.logger,
    });

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
