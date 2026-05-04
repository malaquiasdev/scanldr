// Fallback HTTP client factory.
// Reads the captured auth session once at construction time, then replays
// cookies + UA on every request per ADR-001.

import { readFile } from "node:fs/promises";
import type { AuthSession } from "@integrations/mangakakalot/browser/types.ts";
import { resolveAuthPath } from "@plugins/auth-path/index.ts";
import { CloudflareError, MissingAuthError } from "./types.ts";
import type { FallbackHttpClient, FallbackHttpOptions, FetchFn } from "./types.ts";

const MAX_ATTEMPTS = 4; // 1 initial + 3 retries
const BASE_BACKOFF_MS = 500;
const JITTER_MS = 200;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isValidAuthSession(v: unknown): v is AuthSession {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    obj.cookies !== null &&
    typeof obj.cookies === "object" &&
    !Array.isArray(obj.cookies) &&
    typeof obj.userAgent === "string" &&
    typeof obj.savedAt === "number"
  );
}

export async function createFallbackHttp(opts: FallbackHttpOptions): Promise<FallbackHttpClient> {
  const { logger } = opts;
  const fetchFn: FetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;

  // Resolve path once — either from opts or XDG.
  const path = opts.authPath ?? resolveAuthPath();

  // Read auth.json eagerly — fail fast if missing or corrupt.
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    logger.warn(
      { event: "fallback_http.missing_auth", context: "fallback-http", path, reason: "missing" },
      "auth.json not found",
    );
    throw new MissingAuthError(path);
  }

  let session: AuthSession;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidAuthSession(parsed)) {
      throw new Error("shape mismatch");
    }
    session = parsed;
  } catch {
    logger.warn(
      { event: "fallback_http.missing_auth", context: "fallback-http", path, reason: "corrupt" },
      `auth session at ${path} is corrupt; re-run scanldr auth`,
    );
    throw new MissingAuthError(path);
  }

  logger.info(
    {
      event: "fallback_http.session_loaded",
      context: "fallback-http",
      path,
      savedAt: session.savedAt,
    },
    "auth session loaded",
  );

  // Build cookie header string once — session is immutable for process lifetime.
  // cookieHeader is undefined (not "") when cookies is empty so the header is
  // omitted entirely from the request — sending "Cookie: " confuses some servers.
  const cookieHeader =
    Object.keys(session.cookies).length > 0
      ? Object.entries(session.cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join("; ")
      : undefined;

  const userAgent = session.userAgent;

  // Throttle state — serialized via promise chain so concurrent calls queue up.
  // null = no request made yet; number = timestamp of last request start.
  let lastRequestAt: number | null = null;
  // Pending chain for sequential dispatch (satisfies concurrency test #12).
  let chain: Promise<void> = Promise.resolve();

  async function get(url: string, extraHeaders?: Record<string, string>): Promise<Response> {
    // Enqueue behind prior requests — enforces 1 req/s globally.
    const result = chain.then(() => dispatch(url, extraHeaders));
    // Swallow errors on chain to prevent unhandled rejection bleed between calls.
    chain = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  async function dispatch(url: string, extraHeaders?: Record<string, string>): Promise<Response> {
    // Throttle: sleep if last request was < 1000ms ago.
    if (lastRequestAt !== null) {
      const elapsed = now() - lastRequestAt;
      if (elapsed < 1000) {
        await sleep(1000 - elapsed);
      }
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Throttle is per-fetch (per attempt), not per dispatch.
      // Retries already exceed the 1s window via exponential backoff, so
      // marking each attempt keeps the throttle conservative and correct.
      lastRequestAt = now();

      let res: Response | undefined;
      let fetchError: unknown;

      try {
        // Build base headers; merge caller extras on top (caller wins on conflict).
        const headers: Record<string, string> = { "user-agent": userAgent };
        if (cookieHeader !== undefined) headers.cookie = cookieHeader;
        // Caller-supplied headers are merged AFTER base headers so they take precedence,
        // EXCEPT we always re-enforce cookie and user-agent (security invariant).
        if (extraHeaders) {
          for (const [k, v] of Object.entries(extraHeaders)) {
            const key = k.toLowerCase();
            // Prevent callers from dropping the auth headers.
            if (key === "cookie" || key === "user-agent") continue;
            headers[key] = v;
          }
        }
        res = await fetchFn(url, { headers });
      } catch (err) {
        fetchError = err;
      }

      // 403 — Cloudflare rejection, do NOT retry.
      if (res && res.status === 403) {
        logger.warn(
          { event: "fallback_http.cloudflare_rejected", context: "fallback-http", url },
          "Cloudflare rejected the request",
        );
        throw new CloudflareError(url);
      }

      // 2xx, 3xx, and 4xx other than 403: return to caller (no retry).
      if (res && res.status < 500) {
        return res;
      }

      // 5xx or network error — retry if attempts remain.
      const isLast = attempt === MAX_ATTEMPTS - 1;
      if (isLast) {
        if (fetchError) {
          throw fetchError instanceof Error
            ? fetchError
            : new Error(`Fallback HTTP network error: ${url}`);
        }
        throw new Error(`Fallback HTTP ${res?.status}: ${url}`);
      }

      const status = res ? res.status : 0;
      // Math.random is fine here — jitter only, no security relevance.
      const waitMs = BASE_BACKOFF_MS * 2 ** attempt + Math.floor(Math.random() * JITTER_MS);

      logger.warn(
        {
          event: "fallback_http.retry",
          context: "fallback-http",
          attempt: attempt + 1,
          status,
          url,
          waitMs,
        },
        `retrying after ${waitMs}ms`,
      );

      await sleep(waitMs);
    }

    // invariant: every iteration returns or throws — this line is unreachable.
    throw new Error("invariant: retry loop exited without returning or throwing");
  }

  return { get: (url, headers) => get(url, headers) };
}
