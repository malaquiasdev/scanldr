import { checkbox } from "../prompts.ts";
import type { RangePickerOptions, RangePickerResult } from "../types.ts";
import { WalkthroughError } from "../types.ts";

export type { RangePickerOptions, RangePickerResult } from "../types.ts";

/** Step 6: multi-select available chapters. */
export async function pickRange(opts: RangePickerOptions): Promise<RangePickerResult> {
  const { hit, adapter, preloadedChapters } = opts;

  const chapters = preloadedChapters ?? (await adapter.listChapters(hit.id));
  if (chapters.length === 0) {
    throw new WalkthroughError(
      "No chapters found for this title. The source may not have any available chapters.",
    );
  }

  const selectedIds = await checkbox<string>({
    message: "Select chapters to download:",
    choices: chapters.map((ch, i) => ({
      name: `[${i + 1}] ${ch.label}`,
      value: ch.id,
    })),
    validate: (items: readonly { value: string }[]) =>
      items.length > 0 || "Select at least one item",
  });

  const selected = chapters.filter((ch) => selectedIds.includes(ch.id));
  if (selected.length === 0) throw new WalkthroughError("No bundles selected");
  return {
    bundles: selected.map((ch) => ({
      label: ch.label,
      id: ch.id,
      num: ch.num,
    })),
    chapters,
  };
}
