import type { SourceAdapter } from "../../sources/adapters/index.ts";
import { checkbox } from "../prompts.ts";
import type { BundleItem, ModeSelection, SearchHit } from "../types.ts";
import { WalkthroughError } from "../types.ts";

export interface RangePickerOptions {
  hit: SearchHit;
  mode: ModeSelection;
  adapter: SourceAdapter;
}

/** Step 6: multi-select available chapters or volumes. */
export async function pickRange(opts: RangePickerOptions): Promise<BundleItem[]> {
  const { hit, mode, adapter } = opts;

  if (mode === "volume") {
    const volumes = await adapter.listVolumes(hit.id);
    if (volumes.length === 0) {
      throw new WalkthroughError(
        "This source did not expose volume metadata for this title. Try chapter mode.",
      );
    }

    const selectedIds = await checkbox<string>({
      message: "Select volumes to download:",
      choices: volumes.map((v, i) => ({
        name: `[${i + 1}] ${v.label}`,
        value: `vol:${v.volume}`,
      })),
      validate: (items: readonly { value: string }[]) =>
        items.length > 0 || "Select at least one item",
    });

    const selected = volumes.filter((v) => selectedIds.includes(`vol:${v.volume}`));
    if (selected.length === 0) throw new WalkthroughError("No bundles selected");
    return selected.map((v) => ({
      kind: "volume" as const,
      label: v.label,
      id: `vol:${v.volume}`,
      num: v.volume,
      chapterIds: v.chapterIds,
      chapterNums: v.chapterNums,
    }));
  }

  // chapter mode
  const chapters = await adapter.listChapters(hit.id);
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
  return selected.map((ch) => ({
    kind: "chapter" as const,
    label: ch.label,
    id: ch.id,
    num: ch.num,
  }));
}
