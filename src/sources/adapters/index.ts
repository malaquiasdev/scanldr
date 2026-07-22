// Source adapter registry — maps source id to a SourceAdapter factory.

import type { SourceId } from "../types.ts";
import { createMangakakalotAdapter } from "./mangakakalot.ts";
import type { GetAdapterOptions, SourceAdapter } from "./types.ts";

export type { GetAdapterOptions, SourceAdapter } from "./types.ts";

/**
 * Returns the SourceAdapter for the given source id.
 * Throws when the source id is not registered.
 */
export function getAdapter(sourceId: string, opts: GetAdapterOptions): SourceAdapter {
  const { logger } = opts;
  switch (sourceId as SourceId) {
    case "mangakakalot":
      return createMangakakalotAdapter({ logger });
    default:
      throw new Error(`No adapter registered for source: "${sourceId}"`);
  }
}
