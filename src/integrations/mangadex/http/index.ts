import type { Config } from "@plugins/config/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import type { FetchFn, MangaDexHttpOptions, QueryParams, TokenBucket } from "./types.ts";

export type { FetchFn, MangaDexHttpOptions, QueryParams } from "./types.ts";

const BASE_URL = "https://api.mangadex.org";
const BUCKET_CAPACITY = 5;
const REFILL_INTERVAL_MS = 200; // 1 token per 200ms → max 5 req/s
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

export class MangaDexHttp {
  private readonly baseUrl: string;
  private readonly logger: Logger;
  private readonly config: Config;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly doFetch: FetchFn;
  private readonly bucket: TokenBucket;

  constructor(opts: MangaDexHttpOptions) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    this.logger = opts.logger;
    this.config = opts.config;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.bucket = { tokens: BUCKET_CAPACITY, lastRefill: Date.now() };
  }

  private refillBucket(): void {
    const now = Date.now();
    const elapsed = now - this.bucket.lastRefill;
    const tokensToAdd = Math.floor(elapsed / REFILL_INTERVAL_MS);
    if (tokensToAdd > 0) {
      this.bucket.tokens = Math.min(BUCKET_CAPACITY, this.bucket.tokens + tokensToAdd);
      this.bucket.lastRefill = now;
    }
  }

  private async acquireToken(): Promise<void> {
    this.refillBucket();
    if (this.bucket.tokens > 0) {
      this.bucket.tokens--;
      return;
    }
    const waitMs = REFILL_INTERVAL_MS + jitter();
    this.logger.warn("rate-limit token bucket empty, throttling", { waitMs });
    await this.sleep(waitMs);
    this.refillBucket();
    this.bucket.tokens = Math.max(0, this.bucket.tokens - 1);
  }

  async get<T>(path: string, query?: QueryParams): Promise<T> {
    const url = buildUrl(this.baseUrl, path, query);
    const baseMs = this.config.chapter_delay_ms;

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await this.acquireToken();

      let response: Response;
      try {
        response = await this.doFetch(url);
      } catch (err) {
        lastError = err;
        const waitMs = backoffMs(attempt, baseMs);
        this.logger.debug("network error, retrying", { attempt: attempt + 1, waitMs });
        await this.sleep(waitMs);
        continue;
      }

      if (response.ok) {
        return response.json() as Promise<T>;
      }

      if (response.status === 429) {
        const retryAfterHeader =
          response.headers.get("x-ratelimit-retry-after") ?? response.headers.get("retry-after");

        let waitMs: number;
        if (retryAfterHeader !== null) {
          const parsed = Number(retryAfterHeader);
          // Could be a Unix timestamp (>1e9) or seconds
          if (parsed > 1_000_000_000) {
            waitMs = Math.max(0, parsed * 1000 - Date.now()) + jitter();
          } else {
            waitMs = parsed * 1000 + jitter();
          }
        } else {
          waitMs = backoffMs(attempt, baseMs);
        }

        this.logger.warn("429 rate-limited by server, backing off", {
          attempt: attempt + 1,
          waitMs,
        });
        await this.sleep(waitMs);
        lastError = new Error(`HTTP 429 after ${attempt + 1} attempt(s)`);
        continue;
      }

      if (response.status >= 500) {
        const waitMs = backoffMs(attempt, baseMs);
        this.logger.debug("5xx error, retrying", {
          attempt: attempt + 1,
          status: response.status,
          waitMs,
        });
        await this.sleep(waitMs);
        lastError = new Error(`HTTP ${response.status} after ${attempt + 1} attempt(s)`);
        continue;
      }

      // 4xx non-429: do not retry
      throw new Error(`MangaDex HTTP ${response.status}: ${url}`);
    }

    throw lastError ?? new Error(`MangaDex request failed after ${MAX_RETRIES} attempts: ${url}`);
  }
}
