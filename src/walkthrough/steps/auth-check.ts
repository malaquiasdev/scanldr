import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { hasCloudflareChallengeMarkers } from "@integrations/_shared/cloudflare.ts";
import { atomicWrite } from "@plugins/fs-atomic/index.ts";
import { CloudflareError } from "../../integrations/fallback-http/types.ts";
import { captureSessionViaBrowser } from "../../integrations/mangakakalot/auth/browser-capture/index.ts";
import { parseCurl } from "../../integrations/mangakakalot/auth/curl-parser.ts";
import type { AuthSession } from "../../integrations/mangakakalot/auth/types.ts";
import { resolveAuthPath } from "../../plugins/auth-path/index.ts";
import { toCookieHeader } from "../../plugins/auth-session/index.ts";
import type { Logger } from "../../plugins/logger/index.ts";
import { editor } from "../prompts.ts";
import type {
  AuthCheckOptions,
  AuthResult,
  BrowserCaptureDeps,
  ProbeOutcome,
  RefreshSessionOptions,
  SessionProbeClient,
  SessionProbeClientFactory,
} from "../types.ts";
import { WalkthroughError } from "../types.ts";

export type { AuthCheckOptions } from "../types.ts";

const MAX_PASTE_RETRIES = 2;
/** Search endpoint, not homepage — see ADR-002. */
const PROBE_URL = "https://www.mangakakalot.gg/search/story/__scanldr_probe__";
/** Probe timeout in ms. */
const PROBE_TIMEOUT_MS = 5000;
/**
 * cf_clearance is domain-wide, but the homepage has weaker CF rules than the search
 * endpoint and often doesn't present a challenge at all — leaving the human with
 * nothing to solve and no cf_clearance issued. Open the same URL the probe hits
 * (PROBE_URL) so the challenge reliably appears and the solved cookie covers the
 * whole domain (search/detail/chapter). See ADR-002.
 */
const BROWSER_AUTH_URL = PROBE_URL;

function isValidAuthFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

/** Write session atomically (write .tmp → rename). On rename failure, cleans up .tmp. */
async function persistSession(session: AuthSession, authPath: string): Promise<void> {
  await mkdir(dirname(authPath), { recursive: true, mode: 0o700 });
  await atomicWrite(authPath, JSON.stringify(session, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

/**
 * Probes the session against PROBE_URL with a 5s timeout.
 * Treats 403/503 with Cloudflare markers, and 200 with CF challenge HTML, as stale.
 * A `CloudflareError` thrown by the client on 403 is treated as stale; other 4xx/5xx
 * statuses (403 already handled above) are transient; 3xx redirects are treated as
 * ok (the client follows redirects, or the server is simply live); and if the 200
 * response body can't be read, we assume ok since the server responded with real
 * content.
 */
async function probeSession(client: SessionProbeClient, logger: Logger): Promise<ProbeOutcome> {
  logger.info(
    { event: "walkthrough.auth_probe_start", context: "walkthrough", url: PROBE_URL },
    "probing session against source",
  );

  let res: Response;
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("probe timeout")), PROBE_TIMEOUT_MS),
    );
    res = await Promise.race([client.get(PROBE_URL), timeout]);
  } catch (err) {
    if (err instanceof Error && err.name === "CloudflareError") {
      logger.warn(
        { event: "walkthrough.auth_probe_stale", context: "walkthrough", url: PROBE_URL },
        "session probe: Cloudflare rejected the request — session is stale",
      );
      return { kind: "stale" };
    }
    const message =
      err instanceof Error ? err.message : "unknown network error during session probe";
    logger.warn(
      {
        event: "walkthrough.auth_probe_network_error",
        context: "walkthrough",
        url: PROBE_URL,
        message,
      },
      "session probe: network error",
    );
    return { kind: "network_error", message };
  }

  if (res.status >= 400) {
    return { kind: "transient_error", status: res.status };
  }

  if (res.status >= 200 && res.status < 300) {
    try {
      const text = await res.text();
      if (hasCloudflareChallengeMarkers(text)) {
        logger.warn(
          { event: "walkthrough.auth_probe_stale", context: "walkthrough", url: PROBE_URL },
          "session probe: CF challenge in 200 body — session is stale",
        );
        return { kind: "stale" };
      }
    } catch {}
    logger.info(
      { event: "walkthrough.auth_probe_ok", context: "walkthrough", url: PROBE_URL },
      "session probe: session is valid",
    );
    return { kind: "ok" };
  }

  logger.info(
    { event: "walkthrough.auth_probe_ok", context: "walkthrough", url: PROBE_URL },
    "session probe: session is valid",
  );
  return { kind: "ok" };
}

/**
 * Builds a minimal SessionProbeClient directly from a candidate session (no auth.json
 * read) so an auto-extracted session can be validated BEFORE it's ever persisted.
 * Mirrors fallback-http's CloudflareError-on-403 contract so probeSession's existing
 * stale-detection logic applies unchanged.
 */
function buildCandidateProbeClient(
  session: AuthSession,
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
): SessionProbeClient {
  const cookieHeader = toCookieHeader(session.cookies);
  return {
    get: async (url: string) => {
      const res = await fetchFn(url, {
        headers: { cookie: cookieHeader, "user-agent": session.userAgent },
      });
      if (res.status === 403) throw new CloudflareError(url);
      return res;
    },
  };
}

/**
 * Attempts the browser capture path via patchright: launches Chrome, lets the
 * user solve Cloudflare, harvests cookies and UA, and validates them via probe
 * before returning. Returns undefined on any failure.
 */
async function tryCaptureViaBrowser(
  deps: BrowserCaptureDeps,
  logger: Logger,
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<AuthSession | undefined> {
  try {
    const captured = await captureSessionViaBrowser(deps.launcherDeps, BROWSER_AUTH_URL, logger);
    if (!captured) {
      logger.warn(
        { event: "walkthrough.auth_capture_failed", context: "walkthrough" },
        "browser capture failed or returned no session — falling back to manual paste",
      );
      return undefined;
    }

    const candidate: AuthSession = {
      cookies: captured.cookies,
      userAgent: captured.userAgent,
      savedAt: Date.now(),
    };

    const client = buildCandidateProbeClient(candidate, fetchFn);
    const outcome = await probeSession(client, logger);
    if (outcome.kind !== "ok") {
      logger.warn(
        { event: "walkthrough.auth_capture_probe_failed", context: "walkthrough" },
        "captured session failed probe validation — falling back to manual paste",
      );
      return undefined;
    }

    logger.info(
      { event: "walkthrough.auth_capture_ok", context: "walkthrough" },
      "browser capture succeeded and validated",
    );
    return candidate;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    logger.error(
      { event: "walkthrough.auth_capture_error", context: "walkthrough", message },
      "unexpected error during browser capture — falling back to manual paste",
    );
    return undefined;
  }
}

/** Parses a pasted cURL command, returning null (instead of throwing) on invalid input. */
function tryParseCurl(paste: string): ReturnType<typeof parseCurl> | null {
  try {
    return parseCurl(paste);
  } catch {
    return null;
  }
}

/**
 * Prompt cURL paste loop — returns a parsed AuthSession or throws WalkthroughError.
 * @param fetchFn Defaults to globalThis.fetch; the candidate-probe path
 * (buildCandidateProbeClient) deliberately re-implements the 403->CloudflareError
 * contract so probeSession's stale-detection applies to the not-yet-persisted
 * extracted session (parallel to fallback-http's CF layer, by design).
 */
async function promptAndParseSession(
  logger: Logger,
  browserCapture?: BrowserCaptureDeps,
  fetchFn: (url: string, init?: RequestInit) => Promise<Response> = (...args) =>
    globalThis.fetch(...args),
): Promise<AuthSession> {
  if (browserCapture) {
    const auto = await tryCaptureViaBrowser(browserCapture, logger, fetchFn);
    if (auto) return auto;
  }

  for (let attempt = 0; attempt < MAX_PASTE_RETRIES; attempt++) {
    const paste = await editor({
      message: "No valid session found. Paste a cURL command with cookie headers (opens editor):",
    });

    const parsed = tryParseCurl(paste);

    if (parsed !== null && Object.keys(parsed.cookies).length > 0) {
      return {
        cookies: parsed.cookies,
        userAgent: parsed.userAgent ?? "",
        savedAt: Date.now(),
      };
    }

    const remaining = MAX_PASTE_RETRIES - attempt - 1;
    if (remaining > 0) {
      logger.warn(
        {
          event: "walkthrough.auth_paste_invalid",
          context: "walkthrough",
          attempt: attempt + 1,
          remaining,
        },
        `Invalid cURL paste (must start with "curl " and contain cookies). ${remaining} attempt(s) left.`,
      );
    }
  }

  throw new WalkthroughError(
    `Could not parse cURL paste after ${MAX_PASTE_RETRIES} attempts. Run the walkthrough again.`,
  );
}

export type { RefreshSessionOptions } from "../types.ts";

/**
 * Creates a fresh probe client via `probeClientFactory` and probes it — the common
 * "re-verify right after persisting a new session" step shared by refreshSession and
 * checkAuthWithProbe. Each caller still owns its own outcome->result/throw mapping,
 * since they diverge on messages and returned AuthResult shape.
 */
async function probeFreshClient(
  probeClientFactory: SessionProbeClientFactory,
  logger: Logger,
): Promise<ProbeOutcome> {
  const freshClient = await probeClientFactory();
  return probeSession(freshClient, logger);
}

/**
 * Shared refresh flow used by both auth-check (stale branch) and withSessionRetry.
 * Deletes stale auth.json, prompts for a fresh cURL paste, persists it, and re-probes once.
 * No upfront unlink — persistSession overwrites atomically, so a Ctrl+C mid-paste can't
 * lose credentials. The re-probe (after persisting) uses a fresh client so it reads the
 * new auth.json.
 * Returns { ok: true, refreshed: true } on success.
 * Throws WalkthroughError if the second probe still fails.
 */
export async function refreshSession(opts: RefreshSessionOptions): Promise<AuthResult> {
  const { authPath, probeClientFactory, logger } = opts;

  const session = opts.fetch
    ? await promptAndParseSession(logger, opts.browserCapture, opts.fetch)
    : await promptAndParseSession(logger, opts.browserCapture);
  await persistSession(session, authPath);
  logger.info(
    { event: "walkthrough.auth_refresh_persisted", context: "walkthrough", path: authPath },
    "stale session replaced — new auth saved",
  );

  const retry = await probeFreshClient(probeClientFactory, logger);
  if (retry.kind === "ok") {
    return { ok: true, skipped: false, refreshed: true };
  }
  throw new WalkthroughError("Session refresh failed twice. Try again later.");
}

/** File-presence-only check (no network validation) — used when no probe factory is configured. */
async function checkAuthFilePresenceOnly(
  opts: AuthCheckOptions,
  authPath: string,
): Promise<AuthResult> {
  if (isValidAuthFile(authPath)) {
    return { ok: true, skipped: false };
  }

  const session = opts.fetch
    ? await promptAndParseSession(opts.logger, opts.browserCapture, opts.fetch)
    : await promptAndParseSession(opts.logger, opts.browserCapture);
  await persistSession(session, authPath);
  opts.logger.info(
    { event: "walkthrough.auth_persisted", context: "walkthrough", path: authPath },
    "auth session saved",
  );
  return { ok: true, skipped: false, justAuthenticated: true };
}

/**
 * Probes an existing session file, or prompts for a fresh cURL paste and probes that
 * instead. The single capture attempt on a stale session lives in refreshSession
 * (via promptAndParseSession -> tryCaptureViaBrowser) — must not be duplicated here,
 * or the browser would launch and prompt the human to solve Cloudflare twice on one
 * stale probe. Transient 4xx/5xx statuses are surfaced to the caller without deleting
 * auth.json.
 */
async function checkAuthWithProbe(
  opts: AuthCheckOptions & { probeClientFactory: SessionProbeClientFactory },
  authPath: string,
): Promise<AuthResult> {
  const logger = opts.logger;
  const fetchFn = opts.fetch ?? globalThis.fetch;

  if (isValidAuthFile(authPath)) {
    const client = await opts.probeClientFactory();
    const outcome = await probeSession(client, logger);

    if (outcome.kind === "ok") {
      return { ok: true, skipped: false };
    }

    if (outcome.kind === "stale") {
      return refreshSession({
        authPath,
        probeClientFactory: opts.probeClientFactory,
        logger,
        browserCapture: opts.browserCapture,
        fetch: opts.fetch,
      });
    }

    if (outcome.kind === "network_error") {
      throw new WalkthroughError(
        `Could not reach Mangakakalot to verify session. Check connectivity. (${outcome.message})`,
      );
    }

    throw new WalkthroughError(
      `Mangakakalot returned an unexpected status (${outcome.status}) during session probe. Try again later.`,
    );
  }

  const session = opts.fetch
    ? await promptAndParseSession(logger, opts.browserCapture, fetchFn)
    : await promptAndParseSession(logger, opts.browserCapture);
  await persistSession(session, authPath);
  logger.info(
    { event: "walkthrough.auth_persisted", context: "walkthrough", path: authPath },
    "auth session saved",
  );

  const outcome = await probeFreshClient(opts.probeClientFactory, logger);
  if (outcome.kind === "ok") {
    return { ok: true, skipped: false, justAuthenticated: true };
  }
  if (outcome.kind === "stale") {
    throw new WalkthroughError(
      "The pasted session was immediately rejected by Cloudflare. Ensure you copy the cURL from a fresh browser request and try again.",
    );
  }
  if (outcome.kind === "network_error") {
    throw new WalkthroughError(
      `Could not reach Mangakakalot to verify session. Check connectivity. (${outcome.message})`,
    );
  }
  throw new WalkthroughError(
    `Mangakakalot returned an unexpected status (${outcome.status}) during session probe. Try again later.`,
  );
}

/** Step 3: check auth state. Prompt for cURL paste when needed and persist via auth service. */
export async function checkAuth(opts: AuthCheckOptions): Promise<AuthResult> {
  if (!opts.requiresAuth) {
    return { ok: true, skipped: true };
  }

  const authPath = resolveAuthPath({ dataHome: opts.dataHome });

  if (!opts.probeClientFactory) {
    return checkAuthFilePresenceOnly(opts, authPath);
  }

  return checkAuthWithProbe({ ...opts, probeClientFactory: opts.probeClientFactory }, authPath);
}
