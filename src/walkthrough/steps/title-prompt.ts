import { input } from "../prompts.ts";

/** Step 1: prompt for manga title or URL. Re-prompts when empty. */
export async function promptTitle(): Promise<string> {
  const result = await input({
    message: "Manga title or URL:",
    validate: (v: string) => v.trim().length > 0 || "Title cannot be empty",
  });
  return result.trim();
}
