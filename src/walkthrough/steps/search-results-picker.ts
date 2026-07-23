import { select } from "../prompts.ts";
import type { SearchHit, SearchResultsPickerOptions } from "../types.ts";
import { WalkthroughError } from "../types.ts";

export type { SearchResultsPickerOptions } from "../types.ts";

/** Step 4: search the source and let user pick a result. */
export async function pickSearchResult(opts: SearchResultsPickerOptions): Promise<SearchHit> {
  const results = await opts.adapter.search(opts.query);

  if (results.length === 0) {
    throw new WalkthroughError(
      `No results found for "${opts.query}" on ${opts.sourceLabel}. Try a different title.`,
    );
  }

  const id = await select<string>({
    message: "Select manga:",
    choices: results.map((r, i) => ({
      name: `[${i + 1}] ${r.title}${r.year ? ` (${r.year})` : ""}`,
      value: r.id,
    })),
  });

  const found = results.find((r) => r.id === id);
  if (!found) throw new WalkthroughError(`Unexpected result id: ${id}`);
  return found;
}
