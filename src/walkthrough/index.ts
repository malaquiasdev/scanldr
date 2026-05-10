import type { Logger } from "../plugins/logger/index.ts";
import { checkAuth } from "./steps/auth-check.ts";
import { promptCoverUrl } from "./steps/cover-prompt.ts";
import { executePlan } from "./steps/execute-stub.ts";
import { pickMode } from "./steps/mode-picker.ts";
import { promptPack } from "./steps/pack-prompt.ts";
import { pickRange } from "./steps/range-picker.ts";
import { pickSearchResult } from "./steps/search-results-picker.ts";
import { pickSource } from "./steps/source-picker.ts";
import { promptTitle } from "./steps/title-prompt.ts";
import type { WalkthroughCancelled, WalkthroughInput, WalkthroughResult } from "./types.ts";

export type { WalkthroughCancelled, WalkthroughInput, WalkthroughResult } from "./types.ts";

export interface RunWalkthroughOptions extends WalkthroughInput {
  logger: Logger;
}

/**
 * Composes all 9 walkthrough steps in order.
 * Returns the assembled plan (Phase 2: no real download happens).
 * Returns `{ cancelled: true }` when the user hits Ctrl+C.
 */
export async function runWalkthrough(
  opts: RunWalkthroughOptions,
): Promise<WalkthroughResult | WalkthroughCancelled> {
  try {
    // Step 1 — title
    const title = await promptTitle({ prefill: opts.titlePrefill });

    // Step 2 — source
    const source = await pickSource();

    // Step 3 — auth check
    await checkAuth({ requiresAuth: source.requiresAuth });

    // Step 4 — search results
    const hit = await pickSearchResult({ query: title, sourceId: source.id });

    // Step 5 — mode
    const mode = await pickMode();

    // Step 6 — range
    const selectedBundles = await pickRange({ hit, mode });

    // Step 7 — pack prompt (chapter mode only)
    // volume mode always packs
    const groupIntoVolume = mode === "volume" ? true : await promptPack();

    // Step 8 — cover URL (only when packing)
    const coverUrl = groupIntoVolume ? await promptCoverUrl() : null;

    const result: WalkthroughResult = {
      title,
      source,
      hit,
      mode,
      selectedBundles,
      groupIntoVolume,
      coverUrl,
    };

    // Step 9 — execute (stub in Phase 2)
    return executePlan(result, opts.logger);
  } catch (err) {
    // @inquirer/prompts throws ExitPromptError when the user presses Ctrl+C
    if (err instanceof Error && err.name === "ExitPromptError") {
      return { cancelled: true };
    }
    throw err;
  }
}
