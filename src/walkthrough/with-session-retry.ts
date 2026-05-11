import type { Logger } from "../plugins/logger/index.ts";
import { WalkthroughError } from "./types.ts";

export type RefreshSession = () => Promise<void>;

/**
 * Wraps an adapter call with a single-retry on Cloudflare rejection.
 * If the first attempt throws a CF error, `refresh` is called once to obtain a fresh session,
 * then the call is retried. A second CF failure throws WalkthroughError (caught by orchestrator).
 * All other errors are re-thrown immediately without retry.
 */
export async function withSessionRetry<T>(
  fn: () => Promise<T>,
  isStaleSession: (err: unknown) => boolean,
  refresh: RefreshSession,
  logger: Logger,
  event: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isStaleSession(err)) throw err;
    logger.warn(
      { event, context: "walkthrough", attempt: 1 },
      "Cloudflare rejected; refreshing session and retrying",
    );
    await refresh();
    try {
      return await fn();
    } catch (retryErr) {
      if (!isStaleSession(retryErr)) throw retryErr;
      throw new WalkthroughError(
        "Cloudflare rejected the request after session refresh. Try again later.",
      );
    }
  }
}

/** Type guard for CloudflareError from fallback-http. */
export function isCloudflareError(err: unknown): boolean {
  return err instanceof Error && err.name === "CloudflareError";
}
