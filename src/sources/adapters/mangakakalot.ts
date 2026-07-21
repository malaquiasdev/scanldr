/**
 * Adapter wrapping createMangakakalotClient for the walkthrough SourceAdapter interface.
 * Does NOT modify the integration client — only maps types.
 */

import type { ChapterInput, ImageRef } from "@integrations/_shared/media.ts";
import type { FallbackHttpClient } from "@integrations/fallback-http/index.ts";
import { createFallbackHttp } from "@integrations/fallback-http/index.ts";
import type {
  FallbackChapterRef,
  MangakakalotClient,
} from "@integrations/mangakakalot/client/index.ts";
import { createMangakakalotClient } from "@integrations/mangakakalot/client/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import type { ChapterListing, SearchHit } from "../../walkthrough/types.ts";
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

export function createMangakakalotAdapter(opts: MangakakalotAdapterOptions): SourceAdapter {
  const { logger } = opts;

  /**
   * Lazily-constructed clients — createFallbackHttp is async so we cache the promise
   */
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

  /**
   * Null chapter numbers become the "none" sentinel (downloader/pack understand it);
   * duplicates get disambiguating suffixes "none-1", "none-2" to avoid zip-prefix collisions (#122).
   */
  async function listChapters(hitId: string): Promise<ChapterListing[]> {
    const client = await getClientPromise();
    const chapters = await client.getChapterList(hitId);
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

  async function fetchChapterInput(chapterId: string, chapterNum?: string): Promise<ChapterInput> {
    const [client, http] = await Promise.all([getClientPromise(), getHttpPromise()]);
    const imageRefs = await client.getChapterImages(chapterId);

    const pages: ImageRef[] = imageRefs.map((ref, i) => ({ url: ref.url, page: i + 1 }));

    /**
     * Image CDN is a different Cloudflare zone with hotlink protection: must NOT forward the
     * site cookie (cross-origin leak) and MUST send Referer, or the CDN rejects the request.
     * getAnonymous throws (CloudflareError / short-circuit) before any log — no per-page log on this failure path.
     */
    const imageFetcher = async (ref: ImageRef): Promise<Uint8Array> => {
      const res = await http.getAnonymous(ref.url, {
        referer: "https://www.mangakakalot.gg/",
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "sec-fetch-dest": "image",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "cross-site",
      });
      const buf = await res.arrayBuffer();
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

  return { search, listChapters, fetchChapterInput };
}
