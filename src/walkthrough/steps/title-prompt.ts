import { input } from "../prompts.ts";

export interface TitlePromptOptions {
  prefill?: string;
}

/** Step 1: prompt for manga title or URL. Re-prompts when empty. */
export async function promptTitle(opts: TitlePromptOptions = {}): Promise<string> {
  const result = await input({
    message: "Manga title or URL:",
    default: opts.prefill,
    validate: (v: string) => v.trim().length > 0 || "Title cannot be empty",
  });
  return result.trim();
}
