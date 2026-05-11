// Fallback HTTP client factory.
// Reads auth.json lazily on every request, caching by file mtime to avoid
// re-reads when nothing has changed (ADR-001). This ensures that when
// refreshSession writes new credentials, the next request automatically
// picks them up without requiring a new client instance.

import { readFile, stat } from "node:fs/promises";
import type { AuthSession } from "@integrations/mangakakalot/auth/types.ts";
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

/** Cached auth credentials, keyed by file mtime to detect changes. */
interface AuthCache {
  mtimeMs: number;
  cookieHeader: string | undefined;
  userAgent: string;
}

export async function createFallbackHttp(opts: FallbackHttpOptions): Promise<FallbackHttpClient> {
  const { logger } = opts;
  const fetchFn: FetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;

  // Resolve path once — either from opts or XDG.
  const path = opts.authPath ?? resolveAuthPath();

  // Eagerly verify the file exists and is valid at construction time (fail fast).
  // The actual cached value is populated lazily on first request.
  await loadAuth(path, logger);

  // Mtime-keyed cache: null means not yet loaded (though we verified above it exists).
  let authCache: AuthCache | null = null;

  // Throttle state — serialized via promise chain so concurrent calls queue up.
  // null = no request made yet; number = timestamp of last request start.
  let lastRequestAt: number | null = null;
  // Pending chain for sequential dispatch (satisfies concurrency test #12).
  let chain: Promise<void> = Promise.resolve();

  async function resolveAuth(): Promise<{ cookieHeader: string | undefined; userAgent: string }> {
    // Read file mtime; re-parse only when it has changed since the last load.
    let mtimeMs: number;
    try {
      const s = await stat(path);
      mtimeMs = s.mtimeMs;
    } catch {
      // File was deleted between checks — reload will throw MissingAuthError below.
      mtimeMs = -1;
    }

    if (authCache !== null && authCache.mtimeMs === mtimeMs) {
      return { cookieHeader: authCache.cookieHeader, userAgent: authCache.userAgent };
    }

    const session = await loadAuth(path, logger);
    const cookieHeader =
      Object.keys(session.cookies).length > 0
        ? Object.entries(session.cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join("; ")
        : undefined;
    authCache = { mtimeMs, cookieHeader, userAgent: session.userAgent };
    return { cookieHeader, userAgent: session.userAgent };
  }

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
        // Reload auth credentials if auth.json changed since last request.
        // This is the core fix for P0-1: after refreshSession writes new
        // credentials, the next attempt automatically picks them up.
        const { cookieHeader, userAgent } = await resolveAuth();

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

      // 200 with CF challenge HTML — treat symmetrically with 403.
      if (res && res.status >= 200 && res.status < 300) {
        const body = await peekCfBody(res);
        if (body !== null && isCfChallengeHtml(body)) {
          logger.warn(
            { event: "fallback_http.cloudflare_rejected", context: "fallback-http", url },
            "Cloudflare challenge in 200 body — session is stale",
          );
          throw new CloudflareError(url);
        }
        // Return a synthetic response that re-streams the body we already consumed.
        return rebuildResponse(res, body);
      }

      // 3xx and 4xx other than 403: return to caller (no retry).
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function loadAuth(
  path: string,
  logger: { warn: (fields: Record<string, unknown>, msg: string) => void },
): Promise<AuthSession> {
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

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidAuthSession(parsed)) {
      throw new Error("shape mismatch");
    }
    return parsed;
  } catch {
    logger.warn(
      { event: "fallback_http.missing_auth", context: "fallback-http", path, reason: "corrupt" },
      `auth session at ${path} is corrupt; the walkthrough will re-prompt for a fresh paste`,
    );
    throw new MissingAuthError(path);
  }
}

/**
 * Returns the CF challenge body markers we look for.
 * Must be kept in sync with auth-check.ts probeSession().
 */
function isCfChallengeHtml(body: string): boolean {
  return (
    body.includes("cf-browser-verification") ||
    body.includes("challenge-platform") ||
    body.includes("cdn-cgi/challenge-platform") ||
    body.includes("jschl-answer") ||
    (body.includes("cloudflare") && body.includes("cf_clearance") && body.length < 20000)
  );
}

/**
 * Reads the response body for CF inspection without consuming it irrecoverably.
 * Returns the text, or null if reading fails (caller treats null as "not CF").
 */
async function peekCfBody(res: Response): Promise<string | null> {
  try {
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Wraps an already-consumed body back into a Response so the caller can still
 * call .text() / .json() on the returned response.
 */
function rebuildResponse(original: Response, body: string | null): Response {
  return new Response(body, {
    status: original.status,
    statusText: original.statusText,
    headers: original.headers,
  });
}
