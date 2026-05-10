// PHASE 3: delete this file and replace all usages with real source.search() / getChapterList() / getVolumeMap().

import type { BundleItem, ModeSelection, SearchHit } from "./types.ts";

export function getMockedSearchResults(query: string, _sourceId: string): SearchHit[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `mock-${i + 1}`,
    title: `${query} (result ${i + 1})`,
    originalLanguage: "ja",
    year: 2020 + i,
  }));
}

export function getMockedBundles(hit: SearchHit, mode: ModeSelection): BundleItem[] {
  if (mode === "volume") {
    return Array.from({ length: 3 }, (_, i) => ({
      label: `Volume ${i + 1}`,
      id: `${hit.id}-vol-${i + 1}`,
    }));
  }
  return Array.from({ length: 10 }, (_, i) => ({
    label: `Chapter ${i + 1}`,
    id: `${hit.id}-ch-${i + 1}`,
  }));
}
