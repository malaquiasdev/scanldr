import {
  CloudflareError,
  CrossOriginCloudflareError,
} from "../integrations/fallback-http/types.ts";
import type { Logger } from "../plugins/logger/index.ts";
import { WalkthroughError } from "./types.ts";

export type RefreshSession = () => Promise<void>;

/**
 * Wraps an adapter call with a single-retry on Cloudflare rejection.
 * If the first attempt throws a CF error, `refresh` is called once to obtain a fresh session,
 * then the call is retried. A second CF failure throws WalkthroughError (caught by orchestrator).
 *
 * A CrossOriginCloudflareError (anonymous CDN lane rejection — see issue #137) is NOT a stale
 * session signal: `refresh()` is never called for it, and it is surfaced immediately as a
 * user-facing WalkthroughError pointing at Referer/CDN configuration instead.
 *
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
    if (err instanceof CrossOriginCloudflareError) {
      throw new WalkthroughError(
        `Cloudflare rejected a cross-origin (CDN) request to ${err.url}. This is typically a ` +
          "Referer/hotlink check, not a stale session — refreshing the session will not help. " +
          "Check the Referer header and CDN hotlink configuration for this host.",
      );
    }
    if (!isStaleSession(err)) throw err;
    logger.warn(
      { event, context: "walkthrough", attempt: 1 },
      "Cloudflare rejected; refreshing session and retrying",
    );
    await refresh();
    try {
      return await fn();
    } catch (retryErr) {
      if (retryErr instanceof CrossOriginCloudflareError) {
        throw new WalkthroughError(
          `Cloudflare rejected a cross-origin (CDN) request to ${retryErr.url}. This is typically ` +
            "a Referer/hotlink check, not a stale session — refreshing the session will not help. " +
            "Check the Referer header and CDN hotlink configuration for this host.",
        );
      }
      if (!isStaleSession(retryErr)) throw retryErr;
      throw new WalkthroughError(
        "Cloudflare rejected the request after session refresh. Try again later.",
      );
    }
  }
}

/**
 * Type guard for CloudflareError from fallback-http, excluding the anonymous-lane
 * CrossOriginCloudflareError subclass (handled separately — see withSessionRetry above).
 */
export function isCloudflareError(err: unknown): boolean {
  return err instanceof CloudflareError && !(err instanceof CrossOriginCloudflareError);
}
