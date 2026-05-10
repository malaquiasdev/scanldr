import { getMockedBundles } from "../mocks.ts";
import { checkbox } from "../prompts.ts";
import type { BundleItem, ModeSelection, SearchHit } from "../types.ts";

export interface RangePickerOptions {
  hit: SearchHit;
  mode: ModeSelection;
}

/** Step 6: multi-select available bundles.
 * PHASE 3: replace getMockedBundles with real chapter/volume list from source. */
export async function pickRange(opts: RangePickerOptions): Promise<BundleItem[]> {
  // PHASE 3: replace with real source chapter/volume listing
  const bundles = getMockedBundles(opts.hit, opts.mode);

  const selectedIds = await checkbox<string>({
    message: `Select ${opts.mode === "chapter" ? "chapters" : "volumes"} to download:`,
    choices: bundles.map((b, i) => ({
      name: `[${i + 1}] ${b.label}`,
      value: b.id,
    })),
    validate: (items: readonly { value: string }[]) =>
      items.length > 0 || "Select at least one item",
  });

  const selected = bundles.filter((b) => selectedIds.includes(b.id));
  if (selected.length === 0) {
    throw new Error("No bundles selected");
  }
  return selected;
}
