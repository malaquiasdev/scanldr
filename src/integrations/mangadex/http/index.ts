import { acquire, createBucket } from "./bucket.ts";
import { backoffMs, buildUrl, retryAfterMs } from "./request.ts";
import { MangaDexHttpError } from "./types.ts";
import type { FetchFn, MangaDexHttpClient, MangaDexHttpOptions, QueryParams } from "./types.ts";

export { MangaDexHttpError } from "./types.ts";
export type { FetchFn, MangaDexHttpClient, MangaDexHttpOptions, QueryParams } from "./types.ts";

const BASE_URL = "https://api.mangadex.org";
const MAX_RETRIES = 5;

export function createMangaDexHttp(opts: MangaDexHttpOptions): MangaDexHttpClient {
  const baseUrl = opts.baseUrl ?? BASE_URL;
  const { logger, config } = opts;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const doFetch: FetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const bucket = createBucket();

  async function get<T>(path: string, query?: QueryParams): Promise<T> {
    const url = buildUrl(baseUrl, path, query);
    const baseMs = config.chapter_delay_ms;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await acquire(bucket, logger, sleep);

      let response: Response;
      try {
        response = await doFetch(url);
      } catch (err) {
        lastError = err;
        const waitMs = backoffMs(attempt, baseMs);
        logger.warn(
          { event: "mangadex.network_error", context: "http", attempt: attempt + 1, waitMs },
          "network error, retrying",
        );
        await sleep(waitMs);
        continue;
      }

      if (response.ok) return response.json() as Promise<T>;

      if (response.status === 429) {
        const header =
          response.headers.get("x-ratelimit-retry-after") ?? response.headers.get("retry-after");
        const waitMs = retryAfterMs(header, attempt, baseMs);
        logger.warn(
          { event: "mangadex.rate_limited", context: "http", attempt: attempt + 1, waitMs },
          "429 rate-limited, backing off",
        );
        await sleep(waitMs);
        lastError = new MangaDexHttpError(`HTTP 429 after ${attempt + 1} attempt(s)`, 429);
        continue;
      }

      if (response.status >= 500) {
        const waitMs = backoffMs(attempt, baseMs);
        logger.warn(
          {
            event: "mangadex.server_error",
            context: "http",
            attempt: attempt + 1,
            status: response.status,
            waitMs,
          },
          "5xx error, retrying",
        );
        await sleep(waitMs);
        lastError = new MangaDexHttpError(
          `HTTP ${response.status} after ${attempt + 1} attempt(s)`,
          response.status,
        );
        continue;
      }

      throw new MangaDexHttpError(`MangaDex HTTP ${response.status}: ${url}`, response.status);
    }

    throw lastError ?? new Error(`MangaDex request failed after ${MAX_RETRIES} attempts: ${url}`);
  }

  return { get };
}
