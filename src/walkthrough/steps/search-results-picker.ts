import { getMockedSearchResults } from "../mocks.ts";
import { select } from "../prompts.ts";
import type { SearchHit } from "../types.ts";

export interface SearchResultsPickerOptions {
  query: string;
  sourceId: string;
}

/** Step 4: show search results and let user pick one.
 * PHASE 3: replace getMockedSearchResults with real source.search(query). */
export async function pickSearchResult(opts: SearchResultsPickerOptions): Promise<SearchHit> {
  // PHASE 3: replace with real source.search(query)
  const results = getMockedSearchResults(opts.query, opts.sourceId);

  const id = await select<string>({
    message: "Select manga:",
    choices: results.map((r, i) => ({
      name: `[${i + 1}] ${r.title}${r.year ? ` (${r.year})` : ""}`,
      value: r.id,
    })),
  });

  const found = results.find((r) => r.id === id);
  if (!found) throw new Error(`Unexpected result id: ${id}`);
  return found;
}
