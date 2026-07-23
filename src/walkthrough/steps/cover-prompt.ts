import { input } from "../prompts.ts";
import type { CoverPromptOptions } from "../types.ts";

export type { CoverPromptOptions } from "../types.ts";

const MAX_URL_RETRIES = 2;

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Step 8 (when packing): optionally provide a cover image URL. Skips gracefully after max retries. */
export async function promptCoverUrl(opts: CoverPromptOptions): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_URL_RETRIES; attempt++) {
    const raw = await input({
      message: "Cover image URL? (Enter to skip)",
      default: "",
    });

    const trimmed = raw.trim();

    if (trimmed === "") return null;

    if (isValidUrl(trimmed)) return trimmed;

    const remaining = MAX_URL_RETRIES - attempt - 1;
    if (remaining > 0) {
      opts.logger.warn(
        {
          event: "walkthrough.cover_invalid_url",
          context: "walkthrough",
          attempt: attempt + 1,
          url_input: trimmed,
        },
        "Invalid URL, please try again",
      );
    }
  }

  return null;
}
