import { input } from "../prompts.ts";

/** Step 1: prompt for manga title. Re-prompts when empty or when a URL is pasted. */
export async function promptTitle(): Promise<string> {
  const result = await input({
    message: "Manga title:",
    validate: (v: string) => {
      const trimmed = v.trim();
      if (trimmed.length === 0) return "Title cannot be empty";
      if (/^https?:\/\//i.test(trimmed)) return "Type the manga name, not a URL";
      return true;
    },
  });
  return result.trim();
}
