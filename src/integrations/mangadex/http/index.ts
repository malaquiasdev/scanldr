import type { FetchFn, MangaDexHttpClient, MangaDexHttpOptions, QueryParams } from "./types.ts";

export type { FetchFn, MangaDexHttpClient, MangaDexHttpOptions, QueryParams } from "./types.ts";

const BASE_URL = "https://api.mangadex.org";
const BUCKET_CAPACITY = 5;
const REFILL_INTERVAL_MS = 200;
const MAX_RETRIES = 5;
const JITTER_MS = 200;
const BACKOFF_CAP_MS = 60_000;

function buildUrl(baseUrl: string, path: string, query?: QueryParams): string {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function jitter(): number {
  return Math.floor(Math.random() * JITTER_MS);
}

function backoffMs(attempt: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** attempt + jitter(), BACKOFF_CAP_MS);
}

export function createMangaDexHttp(opts: MangaDexHttpOptions): MangaDexHttpClient {
  const baseUrl = opts.baseUrl ?? BASE_URL;
  const { logger, config } = opts;
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const doFetch: FetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);

  let tokens = BUCKET_CAPACITY;
  let lastRefill = Date.now();

  function refillBucket(): void {
    const now = Date.now();
    const tokensToAdd = Math.floor((now - lastRefill) / REFILL_INTERVAL_MS);
    if (tokensToAdd > 0) {
      tokens = Math.min(BUCKET_CAPACITY, tokens + tokensToAdd);
      lastRefill = now;
    }
  }

  async function acquireToken(): Promise<void> {
    refillBucket();
    if (tokens > 0) {
      tokens--;
      return;
    }
    const waitMs = REFILL_INTERVAL_MS + jitter();
    logger.warn("rate-limit token bucket empty, throttling", { waitMs });
    await sleep(waitMs);
    refillBucket();
    tokens = Math.max(0, tokens - 1);
  }

  async function get<T>(path: string, query?: QueryParams): Promise<T> {
    const url = buildUrl(baseUrl, path, query);
    const baseMs = config.chapter_delay_ms;

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await acquireToken();

      let response: Response;
      try {
        response = await doFetch(url);
      } catch (err) {
        lastError = err;
        const waitMs = backoffMs(attempt, baseMs);
        logger.debug("network error, retrying", { attempt: attempt + 1, waitMs });
        await sleep(waitMs);
        continue;
      }

      if (response.ok) return response.json() as Promise<T>;

      if (response.status === 429) {
        const retryAfterHeader =
          response.headers.get("x-ratelimit-retry-after") ?? response.headers.get("retry-after");

        let waitMs: number;
        if (retryAfterHeader !== null) {
          const parsed = Number(retryAfterHeader);
          waitMs =
            parsed > 1_000_000_000
              ? Math.max(0, parsed * 1000 - Date.now()) + jitter()
              : parsed * 1000 + jitter();
        } else {
          waitMs = backoffMs(attempt, baseMs);
        }

        logger.warn("429 rate-limited by server, backing off", { attempt: attempt + 1, waitMs });
        await sleep(waitMs);
        lastError = new Error(`HTTP 429 after ${attempt + 1} attempt(s)`);
        continue;
      }

      if (response.status >= 500) {
        const waitMs = backoffMs(attempt, baseMs);
        logger.debug("5xx error, retrying", {
          attempt: attempt + 1,
          status: response.status,
          waitMs,
        });
        await sleep(waitMs);
        lastError = new Error(`HTTP ${response.status} after ${attempt + 1} attempt(s)`);
        continue;
      }

      throw new Error(`MangaDex HTTP ${response.status}: ${url}`);
    }

    throw lastError ?? new Error(`MangaDex request failed after ${MAX_RETRIES} attempts: ${url}`);
  }

  return { get };
}
