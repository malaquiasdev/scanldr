import { select } from "../prompts.ts";
import type { ModeSelection } from "../types.ts";

/** Step 5: pick download mode. */
export async function pickMode(): Promise<ModeSelection> {
  const result = await select<ModeSelection>({
    message: "Download mode:",
    choices: [
      { name: "[1] Capítulo", value: "chapter" },
      { name: "[2] Volume", value: "volume" },
    ],
  });
  return result;
}
