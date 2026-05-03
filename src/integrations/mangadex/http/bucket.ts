import type { BucketState } from "./types.ts";

const CAPACITY = 5;
const REFILL_INTERVAL_MS = 200;

export function createBucket(): BucketState {
  return { tokens: CAPACITY, lastRefill: Date.now() };
}

export function refill(bucket: BucketState): void {
  const added = Math.floor((Date.now() - bucket.lastRefill) / REFILL_INTERVAL_MS);
  if (added > 0) {
    bucket.tokens = Math.min(CAPACITY, bucket.tokens + added);
    bucket.lastRefill = Date.now();
  }
}

export async function acquire(
  bucket: BucketState,
  warn: (fields: Record<string, unknown>, msg: string) => void,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  refill(bucket);
  if (bucket.tokens > 0) {
    bucket.tokens--;
    return;
  }
  const waitMs = REFILL_INTERVAL_MS + jitter();
  warn(
    { event: "mangadex.rate_limit", context: "bucket", waitMs },
    "rate-limit token bucket empty, throttling",
  );
  await sleep(waitMs);
  refill(bucket);
  bucket.tokens = Math.max(0, bucket.tokens - 1);
}

function jitter(): number {
  return Math.floor(Math.random() * 200);
}
