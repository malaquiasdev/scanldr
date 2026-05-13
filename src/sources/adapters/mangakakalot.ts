// Adapter wrapping createMangakakalotClient for the walkthrough SourceAdapter interface.
// Does NOT modify the integration client — only maps types.

import { createFallbackHttp } from "@integrations/fallback-http/index.ts";
import type { FallbackHttpClient } from "@integrations/fallback-http/index.ts";
import { createMangakakalotClient } from "@integrations/mangakakalot/client/index.ts";
import type {
  FallbackChapterRef,
  MangakakalotClient,
  VolumeBucket,
} from "@integrations/mangakakalot/client/index.ts";
import type { ChapterInput, ImageRef } from "@modules/downloader/types.ts";
import type { Logger } from "@plugins/logger/index.ts";
import type { ChapterListing, SearchHit, VolumeListing } from "../../walkthrough/types.ts";
import { WalkthroughError } from "../../walkthrough/types.ts";
import type { SourceAdapter } from "./types.ts";

export interface MangakakalotAdapterOptions {
  logger: Logger;
  /** Injected client — used in tests. Production omits this and builds the real one. */
  client?: MangakakalotClient;
  /** Injected HTTP client — used in tests. Production omits this. */
  http?: FallbackHttpClient;
}

function buildChapterLabel(ref: FallbackChapterRef, index: number): string {
  const num = ref.chapter !== null ? ref.chapter : String(index + 1);
  return `Chapter ${num}`;
}

function buildVolumeLabel(bucket: VolumeBucket): string {
  const first = bucket.chapters[0];
  const last = bucket.chapters[bucket.chapters.length - 1];
  if (bucket.volume === "unknown") {
    return "Uncategorised chapters";
  }
  if (first && last && first.chapter !== null && last.chapter !== null) {
    return `Volume ${bucket.volume} (Ch. ${first.chapter}–${last.chapter})`;
  }
  return `Volume ${bucket.volume}`;
}

export function createMangakakalotAdapter(opts: MangakakalotAdapterOptions): SourceAdapter {
  const { logger } = opts;

  // Lazily-constructed clients — createFallbackHttp is async so we cache the promise
  let _httpPromise: Promise<FallbackHttpClient> | undefined;
  function getHttpPromise(): Promise<FallbackHttpClient> {
    if (opts.http) return Promise.resolve(opts.http);
    if (!_httpPromise) _httpPromise = createFallbackHttp({ logger });
    return _httpPromise;
  }

  let _clientPromise: Promise<MangakakalotClient> | undefined;
  function getClientPromise(): Promise<MangakakalotClient> {
    if (opts.client) return Promise.resolve(opts.client);
    if (!_clientPromise) {
      _clientPromise = getHttpPromise().then((http) => createMangakakalotClient({ http, logger }));
    }
    return _clientPromise;
  }

  async function search(query: string): Promise<SearchHit[]> {
    const client = await getClientPromise();
    const results = await client.searchManga(query);
    return results.map((r) => ({
      id: r.id,
      title: r.title,
      originalLanguage: r.originalLanguage,
      year: r.year,
    }));
  }

  async function listChapters(hitId: string): Promise<ChapterListing[]> {
    const client = await getClientPromise();
    const chapters = await client.getChapterList(hitId);
    return chapters.map((ch, i) => {
      const num = ch.chapter ?? String(i + 1);
      return {
        id: ch.id,
        num,
        label: buildChapterLabel({ id: ch.id, chapter: ch.chapter }, i),
      };
    });
  }

  async function listVolumes(hitId: string): Promise<VolumeListing[]> {
    const client = await getClientPromise();
    const volumeMap = await client.getVolumeMap(hitId);

    if (volumeMap.length === 0) {
      throw new WalkthroughError(
        "This source did not expose volume metadata for this title. Try chapter mode.",
      );
    }

    return volumeMap.map((bucket, bucketIndex) => {
      const chapterIds = bucket.chapters.map((ch) => ch.id);
      const chapterNums = bucket.chapters.map(
        (ch, i) => ch.chapter ?? String(bucketIndex * 1000 + i + 1),
      );
      return {
        volume: bucket.volume,
        label: buildVolumeLabel(bucket),
        chapterIds,
        chapterNums,
      };
    });
  }

  async function fetchChapterInput(chapterId: string, chapterNum?: string): Promise<ChapterInput> {
    const [client, http] = await Promise.all([getClientPromise(), getHttpPromise()]);
    const imageRefs = await client.getChapterImages(chapterId);

    const pages: ImageRef[] = imageRefs.map((ref, i) => ({ url: ref.url, page: i + 1 }));

    const total = pages.length;
    const chapterNumLabel = chapterNum ?? "?";
    const imageFetcher = async (ref: ImageRef): Promise<Uint8Array> => {
      const res = await http.get(ref.url); // CloudflareError or short-circuit throws here — no log emitted
      const buf = await res.arrayBuffer();
      logger.info(
        {
          event: "walkthrough.fetch_page",
          context: "walkthrough",
          url: ref.url,
          page: ref.page,
          total,
          chapter: chapterNumLabel,
        },
        `fetched page ${ref.page}/${total} of chapter ${chapterNumLabel}`,
      );
      return new Uint8Array(buf);
    };

    const numRaw = chapterNum ?? "0";
    const numParsed = Number(numRaw);
    const num = Number.isNaN(numParsed) ? 0 : numParsed;
    if (Number.isNaN(Number(numRaw))) {
      logger.warn(
        { event: "walkthrough.chapter_num_parse_failed", context: "walkthrough", chapterNum },
        "could not parse chapter number; defaulting to 0",
      );
    }

    return {
      id: chapterId,
      num,
      pages,
      imageFetcher,
    };
  }

  return { search, listChapters, listVolumes, fetchChapterInput };
}
