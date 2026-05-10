// Source adapter registry — maps source id to a SourceAdapter factory.

import type { Logger } from "@plugins/logger/index.ts";
import type { SourceId } from "../types.ts";
import { createMangaDexAdapter } from "./mangadex.ts";
import { createMangakakalotAdapter } from "./mangakakalot.ts";
import type { SourceAdapter } from "./types.ts";

export type { SourceAdapter } from "./types.ts";

export interface GetAdapterOptions {
  logger: Logger;
}

/**
 * Returns the SourceAdapter for the given source id.
 * Throws when the source id is not registered.
 */
export function getAdapter(sourceId: string, opts: GetAdapterOptions): SourceAdapter {
  const { logger } = opts;
  switch (sourceId as SourceId) {
    case "mangakakalot":
      return createMangakakalotAdapter({ logger });
    case "mangadex":
      return createMangaDexAdapter({ logger });
    default:
      throw new Error(`No adapter registered for source: "${sourceId}"`);
  }
}
