import type { ImageRef } from "@modules/downloader/types.ts";
import { AtHomeError } from "./types.ts";
import type {
  AtHomeOptions,
  AtHomeServer,
  AtHomeServerResponse,
  ImageQuality,
  ReportPayload,
} from "./types.ts";

export { AtHomeError } from "./types.ts";
export type { AtHomeOptions, AtHomeServer, ImageQuality, ReportPayload } from "./types.ts";

const REPORT_URL = "https://api.mangadex.network/report";
const MAX_ATTEMPTS = 5;

// Parse HTTP status from error messages like "MangaDex HTTP 404: <url>"
function parseHttpStatus(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const match = /^MangaDex HTTP (\d+):/.exec(err.message);
  return match ? Number(match[1]) : null;
}

export async function getAtHomeServer(
  httpClient: AtHomeOptions["httpClient"],
  chapterId: string,
  quality: ImageQuality = "data",
): Promise<AtHomeServer> {
  try {
    const res = await httpClient.get<AtHomeServerResponse>(`/at-home/server/${chapterId}`);
    return {
      baseUrl: res.baseUrl,
      hash: res.chapter.hash,
      pages: quality === "data" ? res.chapter.data : res.chapter.dataSaver,
    };
  } catch (err) {
    const status = parseHttpStatus(err);
    if (status !== null) {
      const msg =
        status === 404
          ? `at-home server returned 404 for chapter ${chapterId}. Likely an externally-hosted chapter (MangaPlus / Comikey / Cubari). Check chapter.externalUrl in the feed.`
          : `at-home server returned ${status} for chapter ${chapterId}`;
      throw new AtHomeError(chapterId, status, msg);
    }
    throw err;
  }
}

async function sendReport(
  payload: ReportPayload,
  doFetch: NonNullable<AtHomeOptions["fetch"]>,
  logger: AtHomeOptions["logger"],
): Promise<void> {
  try {
    await doFetch(REPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    logger.warn(
      { event: "mangadex.report_failed", context: "at-home", url: payload.url, err },
      "failed to send at-home report",
    );
  }
}

/**
 * Factory returning an imageFetcher compatible with DownloadVolumeInput.imageFetcher.
 * chapterId is required to re-fetch a fresh CDN URL on each retry.
 */
export function mangadexImageFetcher(
  chapterId: string,
  opts: AtHomeOptions,
): (ref: ImageRef) => Promise<Uint8Array> {
  const { httpClient, logger, quality = "data" } = opts;
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return async function fetchImage(ref: ImageRef): Promise<Uint8Array> {
    let lastErr: unknown;
    // Cache the server result; only re-fetch after a failure to get a fresh CDN URL.
    let server = await getAtHomeServer(httpClient, chapterId, quality);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const filename = server.pages[ref.page - 1] ?? ref.url;
      const imageUrl = `${server.baseUrl}/${quality}/${server.hash}/${filename}`;

      const start = Date.now();
      let response: Response;
      let success = false;
      let bytes = 0;

      try {
        response = await doFetch(imageUrl);
      } catch (err) {
        lastErr = err;
        const waitMs = 500 * 2 ** attempt;
        logger.warn(
          {
            event: "mangadex.image_network_error",
            context: "at-home",
            attempt: attempt + 1,
            page: ref.page,
            waitMs,
          },
          "image fetch network error, retrying",
        );
        // fire-and-forget report for network failure
        void sendReport(
          { url: imageUrl, success: false, bytes: 0, duration: Date.now() - start, cached: false },
          doFetch,
          logger,
        );
        await sleep(waitMs);
        try {
          server = await getAtHomeServer(httpClient, chapterId, quality);
        } catch (refreshErr) {
          // AtHomeError already has a clear message (e.g. 404 = externally-hosted chapter).
          // Propagate it directly so the user sees the real cause, not a generic retry message.
          if (refreshErr instanceof AtHomeError) throw refreshErr;
          lastErr = refreshErr;
          break;
        }
        continue;
      }

      const duration = Date.now() - start;
      const cached = response.headers.get("x-cache")?.startsWith("HIT") ?? false;

      if (!response.ok) {
        lastErr = new Error(`HTTP ${response.status} fetching image page ${ref.page}`);
        const waitMs = 500 * 2 ** attempt;
        logger.warn(
          {
            event: "mangadex.image_error",
            context: "at-home",
            attempt: attempt + 1,
            page: ref.page,
            status: response.status,
            waitMs,
          },
          "image fetch failed, retrying with fresh CDN URL",
        );
        void sendReport(
          { url: imageUrl, success: false, bytes: 0, duration, cached },
          doFetch,
          logger,
        );
        await sleep(waitMs);
        try {
          server = await getAtHomeServer(httpClient, chapterId, quality);
        } catch (refreshErr) {
          if (refreshErr instanceof AtHomeError) throw refreshErr;
          lastErr = refreshErr;
          break;
        }
        continue;
      }

      const data = new Uint8Array(await response.arrayBuffer());
      bytes = data.byteLength;
      success = true;

      void sendReport({ url: imageUrl, success, bytes, duration, cached }, doFetch, logger);
      return data;
    }

    throw (
      lastErr ?? new Error(`Failed to fetch image page ${ref.page} after ${MAX_ATTEMPTS} attempts`)
    );
  };
}
