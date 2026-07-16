// Fallback HTTP client factory — auth cache uses lazy mtime re-read; see ADR-001.

import { readFile, stat } from "node:fs/promises";
import type { AuthSession } from "@integrations/mangakakalot/auth/types.ts";
import { resolveAuthPath } from "@plugins/auth-path/index.ts";
import type { FallbackHttpClient, FallbackHttpOptions, FetchFn } from "./types.ts";
import { CloudflareError, CrossOriginCloudflareError, MissingAuthError } from "./types.ts";

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

  const path = opts.authPath ?? resolveAuthPath();

  // Fail fast at construction; the cached value itself is populated lazily on first request.
  await loadAuth(path, logger);

  let authCache: AuthCache | null = null;

  // per-lane CF short-circuit; see ADR-001 / #137
  const siteLatch = createCfLatch();
  const anonLatch = createCfLatch();

  // Serialized via promise chain so concurrent calls queue up (enforces 1 req/s globally).
  let lastRequestAt: number | null = null;
  let chain: Promise<void> = Promise.resolve();

  async function resolveAuth(): Promise<{ cookieHeader: string | undefined; userAgent: string }> {
    let mtimeMs: number;
    try {
      const s = await stat(path);
      mtimeMs = s.mtimeMs;
    } catch {
      mtimeMs = -1; // deleted between checks — reload will throw MissingAuthError below
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

  function enqueue(
    url: string,
    extraHeaders: Record<string, string> | undefined,
    withCookie: boolean,
  ): Promise<Response> {
    const result = chain.then(() => dispatch(url, extraHeaders, withCookie));
    chain = swallowRejection(result);
    return result;
  }

  async function get(url: string, extraHeaders?: Record<string, string>): Promise<Response> {
    return enqueue(url, extraHeaders, true);
  }

  async function getAnonymous(
    url: string,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    return enqueue(url, extraHeaders, false);
  }

  async function throttle(): Promise<void> {
    if (lastRequestAt === null) return;
    const elapsed = now() - lastRequestAt;
    if (elapsed < 1000) {
      await sleep(1000 - elapsed);
    }
  }

  async function dispatch(
    url: string,
    extraHeaders: Record<string, string> | undefined,
    withCookie: boolean,
  ): Promise<Response> {
    const latch = withCookie ? siteLatch : anonLatch;
    if (await latch.shouldShortCircuit(path)) {
      // no re-log here — see createCfLatch
      throw withCookie ? new CloudflareError(url) : new CrossOriginCloudflareError(url);
    }

    await throttle();

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      lastRequestAt = now(); // marked per-attempt so retries stay throttle-conservative

      let res: Response | undefined;
      let fetchError: unknown;

      try {
        // picks up freshly-written credentials if refreshSession ran since the last attempt
        const { cookieHeader, userAgent } = await resolveAuth();

        const baseHeaders: Record<string, string> = { "user-agent": userAgent };
        if (withCookie && cookieHeader !== undefined) baseHeaders.cookie = cookieHeader;
        const headers = mergeHeadersPreservingAuth(baseHeaders, extraHeaders);
        res = await fetchFn(url, { headers });
      } catch (err) {
        fetchError = err;
      }

      if (res && res.status === 403) {
        logger.warn(
          {
            event: "fallback_http.cloudflare_rejected",
            context: "fallback-http",
            url,
            lane: withCookie ? "site" : "anonymous",
          },
          "Cloudflare rejected the request",
        );
        await latch.record(path);
        throw withCookie ? new CloudflareError(url) : new CrossOriginCloudflareError(url);
      }

      // treat a CF challenge disguised as 200 symmetrically with 403
      if (res && res.status >= 200 && res.status < 300) {
        const contentType = res.headers.get("content-type") ?? "";
        if (!isTextualContentType(contentType)) {
          return res;
        }
        const body = await peekCfBody(res);
        if (body !== null && isCfChallengeHtml(body)) {
          logger.warn(
            {
              event: "fallback_http.cloudflare_rejected",
              context: "fallback-http",
              url,
              lane: withCookie ? "site" : "anonymous",
            },
            "Cloudflare challenge in 200 body — session is stale",
          );
          await latch.record(path);
          throw withCookie ? new CloudflareError(url) : new CrossOriginCloudflareError(url);
        }
        return rebuildResponse(res, body);
      }

      if (res && res.status < 500) {
        return res; // 3xx/4xx other than 403 — caller's problem, no retry
      }

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

    throw new Error("invariant: retry loop exited without returning or throwing — unreachable");
  }

  return {
    get: (url, headers) => get(url, headers),
    getAnonymous: (url, headers) => getAnonymous(url, headers),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Prevents unhandled rejection bleed between chained calls. */
function swallowRejection(p: Promise<unknown>): Promise<void> {
  return p.then(
    () => {},
    () => {},
  );
}

/** Merges caller headers onto base, but cookie/user-agent are always re-enforced from base. */
function mergeHeadersPreservingAuth(
  base: Record<string, string>,
  extra: Record<string, string> | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { ...base };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      const key = k.toLowerCase();
      if (key === "cookie" || key === "user-agent") continue;
      headers[key] = v;
    }
  }
  return headers;
}

/** True for content-types safe to decode as text (binary bodies corrupt bytes if decoded). */
function isTextualContentType(contentType: string): boolean {
  return /^(text\/|application\/(json|xml|xhtml\+xml))/i.test(contentType) || contentType === "";
}

/**
 * Per-lane CF short-circuit latch. Records the auth.json mtime at the moment
 * a CloudflareError was observed; while that mtime still matches the file on
 * disk, `shouldShortCircuit` returns true and the caller skips the HTTP call
 * entirely. The latch clears itself once it observes the mtime has advanced
 * (i.e. refreshSession wrote new credentials). See ADR-001 / #137.
 */
function createCfLatch() {
  let rejectedAtMtime: number | null = null;

  return {
    async shouldShortCircuit(authPath: string): Promise<boolean> {
      if (rejectedAtMtime === null) return false;
      const currentMtime = await statMtime(authPath);
      if (currentMtime === rejectedAtMtime) return true;
      // mtime advanced → refreshSession wrote new credentials; clear the latch.
      rejectedAtMtime = null;
      return false;
    },
    async record(authPath: string): Promise<void> {
      rejectedAtMtime = await statMtime(authPath);
    },
  };
}

/** Returns the mtime (ms) of the given file path, or -1 if the file is missing. */
async function statMtime(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath);
    return s.mtimeMs;
  } catch {
    return -1;
  }
}

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
