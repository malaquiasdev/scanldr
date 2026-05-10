import { input } from "../prompts.ts";

const MAX_URL_RETRIES = 2;

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Step 8 (when packing): optionally provide a cover image URL. */
export async function promptCoverUrl(): Promise<string | null> {
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
      process.stderr.write(`Invalid URL. ${remaining} attempt(s) left or press Enter to skip.\n`);
    }
  }

  // After max retries with invalid URL, skip gracefully
  return null;
}
