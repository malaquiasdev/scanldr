import type { Logger } from "../../plugins/logger/index.ts";
import type { WalkthroughResult } from "../types.ts";

/** Step 9: print execution plan and return the assembled result.
 * PHASE 3: wire to real download → pack pipeline. */
export function executePlan(result: WalkthroughResult, logger: Logger): WalkthroughResult {
  logger.info(
    {
      event: "walkthrough.plan_ready",
      context: "walkthrough",
      source: result.source.id,
      title: result.title,
      hit: result.hit.title,
      mode: result.mode,
      bundles: result.selectedBundles.length,
      groupIntoVolume: result.groupIntoVolume,
      coverUrl: result.coverUrl ?? "(none)",
    },
    "walkthrough plan assembled — ready to execute",
  );

  // PHASE 3: wire to real download → pack pipeline

  return result;
}
