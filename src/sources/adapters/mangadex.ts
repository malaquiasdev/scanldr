// Adapter wrapping createMangaDexClient for the walkthrough SourceAdapter interface.
// Does NOT modify the integration client — only maps types.

import { getAtHomeServer, mangadexImageFetcher } from "@integrations/mangadex/at-home/index.ts";
import { createMangaDexClient } from "@integrations/mangadex/client/index.ts";
import type { MangaDexClient, VolumeRef } from "@integrations/mangadex/client/index.ts";
import { createMangaDexHttp } from "@integrations/mangadex/http/index.ts";
import type { MangaDexHttpClient } from "@integrations/mangadex/http/index.ts";
import type { ChapterInput, ImageRef } from "@modules/downloader/types.ts";
import type { Config } from "@plugins/config/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import type { ChapterListing, SearchHit, VolumeListing } from "../../walkthrough/types.ts";
import { WalkthroughError } from "../../walkthrough/types.ts";
import type { SourceAdapter } from "./types.ts";

const DEFAULT_LANGUAGES = ["en"];

/** Minimal config subset used by MangaDex HTTP layer. */
const DEFAULT_CONFIG: Config = {
  preferred_languages: DEFAULT_LANGUAGES,
  download_quality: "data",
  default_format: "cbz",
  default_out: ".",
  db_path: "",
  image_concurrency: 4,
  chapter_delay_ms: 500,
};

export interface MangaDexAdapterOptions {
  logger: Logger;
  /** Injected client — used in tests. */
  client?: MangaDexClient;
  /** Injected http — used in tests. */
  http?: MangaDexHttpClient;
  /** Optional config override. */
  config?: Config;
}

function buildVolumeLabel(v: VolumeRef): string {
  const count = v.chapterIds.length;
  return `Volume ${v.volume} (${count} chapter${count !== 1 ? "s" : ""})`;
}

export function createMangaDexAdapter(opts: MangaDexAdapterOptions): SourceAdapter {
  const { logger } = opts;
  const config = opts.config ?? DEFAULT_CONFIG;

  function getHttp(): MangaDexHttpClient {
    return opts.http ?? createMangaDexHttp({ logger, config });
  }

  function getClient(): MangaDexClient {
    if (opts.client) return opts.client;
    return createMangaDexClient(getHttp());
  }

  async function search(query: string): Promise<SearchHit[]> {
    const client = getClient();
    const results = await client.searchManga(query);
    return results.map((r) => ({
      id: r.id,
      title: r.title,
      originalLanguage: r.originalLanguage,
      year: r.year,
    }));
  }

  async function listChapters(hitId: string): Promise<ChapterListing[]> {
    const client = getClient();
    const chapters = await client.feedChapters(hitId, DEFAULT_LANGUAGES);
    return chapters.map((ch) => ({
      id: ch.id,
      label:
        ch.chapter !== null ? `Chapter ${ch.chapter}${ch.title ? ` — ${ch.title}` : ""}` : ch.id,
    }));
  }

  async function listVolumes(hitId: string): Promise<VolumeListing[]> {
    const client = getClient();
    const volumes = await client.aggregateVolumes(hitId, DEFAULT_LANGUAGES);

    if (volumes.length === 0) {
      throw new WalkthroughError(
        "This source did not expose volume metadata for this title. Try chapter mode.",
      );
    }

    return volumes.map((v) => ({
      id: `vol:${v.volume}:${hitId}`,
      label: buildVolumeLabel(v),
    }));
  }

  async function fetchChapterInput(chapterId: string): Promise<ChapterInput> {
    const http = getHttp();
    const server = await getAtHomeServer(http, chapterId, "data", logger);

    const pages: ImageRef[] = server.pages.map((filename, i) => ({
      url: filename,
      page: i + 1,
    }));

    const imageFetcher = mangadexImageFetcher(chapterId, {
      httpClient: http,
      logger,
      quality: "data",
    });

    return {
      id: chapterId,
      num: 0,
      pages,
      imageFetcher,
    };
  }

  return { search, listChapters, listVolumes, fetchChapterInput };
}
