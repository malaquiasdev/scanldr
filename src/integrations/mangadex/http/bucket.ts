import type { Logger } from "@plugins/logger/index.ts";
import type { BucketState } from "./types.ts";
import { jitter } from "./util.ts";

const CAPACITY = 5;
const REFILL_INTERVAL_MS = 200;

export function createBucket(): BucketState {
  return { tokens: CAPACITY, lastRefill: Date.now() };
}

function refill(bucket: BucketState): void {
  const added = Math.floor((Date.now() - bucket.lastRefill) / REFILL_INTERVAL_MS);
  if (added > 0) {
    bucket.tokens = Math.min(CAPACITY, bucket.tokens + added);
    bucket.lastRefill = Date.now();
  }
}

export async function acquire(
  bucket: BucketState,
  logger: Logger,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  refill(bucket);
  if (bucket.tokens > 0) {
    bucket.tokens--;
    return;
  }
  const waitMs = REFILL_INTERVAL_MS + jitter();
  logger.warn(
    { event: "mangadex.rate_limit", context: "bucket", waitMs },
    "rate-limit token bucket empty, throttling",
  );
  await sleep(waitMs);
  refill(bucket);
  bucket.tokens = Math.max(0, bucket.tokens - 1);
}
