// Adapter wrapping createMangakakalotClient for the walkthrough SourceAdapter interface.
// Does NOT modify the integration client — only maps types.

import type { ChapterInput, ImageRef } from "@integrations/_shared/media.ts";
import type { FallbackHttpClient } from "@integrations/fallback-http/index.ts";
import { createFallbackHttp } from "@integrations/fallback-http/index.ts";
import type {
  FallbackChapterRef,
  MangakakalotClient,
  VolumeBucket,
} from "@integrations/mangakakalot/client/index.ts";
import { createMangakakalotClient } from "@integrations/mangakakalot/client/index.ts";
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

function buildChapterLabel(ref: FallbackChapterRef): string {
  const num = ref.chapter !== null ? ref.chapter : "none";
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
    // No synthetic sequential/misleading chapter number here — "none" is the
    // sentinel the downloader/pack layer already understands (padBundleNumber
    // passes it through unchanged, chapterTokenToNum sorts it last). Multiple
    // null chapters get a disambiguating suffix ("none-1", "none-2", ...) so
    // their zip-prefix/filename never collides (see #122 follow-up bug).
    let noneIdx = 0;
    return chapters.map((ch) => {
      const num = ch.chapter !== null ? ch.chapter : `none-${++noneIdx}`;
      return {
        id: ch.id,
        num,
        label: buildChapterLabel({ id: ch.id, chapter: ch.chapter }),
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

    // No synthetic bucketIndex-based number — "none" is the sentinel the
    // downloader/pack layer already understands. Disambiguate multiple null
    // chapters across the whole listing ("none-1", "none-2", ...) so two
    // null chapters packed into the same volume never collide on zip prefix.
    let noneIdx = 0;
    return volumeMap.map((bucket) => {
      const chapterIds = bucket.chapters.map((ch) => ch.id);
      const chapterNums = bucket.chapters.map((ch) =>
        ch.chapter !== null ? ch.chapter : `none-${++noneIdx}`,
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
      // Image CDN (img-r1.2xstorage.com) is a different Cloudflare zone with hotlink
      // protection. We must NOT forward the site cookie (cross-origin leakage) and
      // MUST include Referer so the CDN allows the request.
      const res = await http.getAnonymous(ref.url, {
        referer: "https://www.mangakakalot.gg/",
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "sec-fetch-dest": "image",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "cross-site",
      }); // CloudflareError or short-circuit throws here — no log emitted
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
