import type { Logger } from "../../plugins/logger/index.ts";
import { input } from "../prompts.ts";

const MAX_RETRIES = 2;

function isUnsafeName(value: string): boolean {
  if (value.includes("/") || value.includes("\\")) return true;
  return value.split(/[\\/]/).some((s) => s === "..");
}

export interface VolumeNamePromptOptions {
  logger: Logger;
}

/**
 * Step 7b (only when the user opted to group into a volume): ask the user for
 * a volume number or custom name. Empty input keeps the chapter-range-derived default.
 */
export async function promptVolumeName(opts: VolumeNamePromptOptions): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const raw = await input({
      message: "Volume number or name? (Enter to keep chapter range)",
      default: "",
    });

    const trimmed = raw.trim();
    if (trimmed === "") return null;

    if (!isUnsafeName(trimmed)) return trimmed;

    const remaining = MAX_RETRIES - attempt - 1;
    if (remaining > 0) {
      opts.logger.warn(
        {
          event: "walkthrough.volume_name_invalid",
          context: "walkthrough",
          attempt: attempt + 1,
          name_input: trimmed,
        },
        "Volume name cannot contain '/', '\\', or '..'; try again",
      );
    }
  }

  return null;
}
