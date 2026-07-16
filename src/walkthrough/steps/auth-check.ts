import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseCurl } from "../../integrations/mangakakalot/auth/curl-parser.ts";
import type { AuthSession } from "../../integrations/mangakakalot/auth/types.ts";
import { resolveAuthPath } from "../../plugins/auth-path/index.ts";
import type { Logger } from "../../plugins/logger/index.ts";
import { editor } from "../prompts.ts";
import type { AuthResult, SessionProbeClient, SessionProbeClientFactory } from "../types.ts";
import { WalkthroughError } from "../types.ts";

export interface AuthCheckOptions {
  requiresAuth: boolean;
  logger: Logger;
  /** Injected in tests to override the default XDG auth path. */
  dataHome?: string;
  /**
   * Factory that creates the probe client on demand (after auth.json is written).
   * When omitted, no network probe is performed (file-presence check only).
   * Injected in tests; production callers provide via runWalkthrough options.
   */
  probeClientFactory?: SessionProbeClientFactory;
}

const MAX_PASTE_RETRIES = 2;
/**
 * Probe target: the search endpoint, not the homepage.
 * The homepage has weaker Cloudflare rules and gives false positives — a 200 there
 * does NOT guarantee the session works for search, which has stricter CF rules.
 * A benign query ("__scanldr_probe__") returns a "no results" page when the session
 * is valid, and triggers a CF challenge when the session is stale — exactly the
 * same behaviour the walkthrough encounters in step 4.
 */
const PROBE_URL = "https://www.mangakakalot.gg/search/story/__scanldr_probe__";
/** Probe timeout in ms. */
const PROBE_TIMEOUT_MS = 5000;

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
  const tmpPath = `${authPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(session, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    await rename(tmpPath, authPath);
  } catch (renameErr) {
    try {
      await unlink(tmpPath);
    } catch {
      // best-effort cleanup — ignore unlink errors
    }
    throw renameErr;
  }
}

type ProbeOutcome =
  | { kind: "ok" }
  | { kind: "stale" }
  | { kind: "network_error"; message: string }
  | { kind: "transient_error"; status: number };

/**
 * Probes the session against PROBE_URL with a 5s timeout.
 * Treats 403/503 with Cloudflare markers, and 200 with CF challenge HTML, as stale.
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
    // CloudflareError is thrown by the client on 403 — treat as stale
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

  if (res.status >= 500) {
    return { kind: "transient_error", status: res.status };
  }

  // 403 is already caught above as CloudflareError; other 4xx are transient.
  if (res.status >= 400) {
    return { kind: "transient_error", status: res.status };
  }

  if (res.status >= 200 && res.status < 300) {
    try {
      const text = await res.text();
      // Cloudflare challenge pages always include these markers
      if (
        text.includes("cf-browser-verification") ||
        text.includes("challenge-platform") ||
        text.includes("cdn-cgi/challenge-platform") ||
        text.includes("jschl-answer") ||
        (text.includes("cloudflare") && text.includes("cf_clearance") && text.length < 20000)
      ) {
        logger.warn(
          { event: "walkthrough.auth_probe_stale", context: "walkthrough", url: PROBE_URL },
          "session probe: CF challenge in 200 body — session is stale",
        );
        return { kind: "stale" };
      }
    } catch {
      // If we can't read the body, assume ok (server responded with real content)
    }
    logger.info(
      { event: "walkthrough.auth_probe_ok", context: "walkthrough", url: PROBE_URL },
      "session probe: session is valid",
    );
    return { kind: "ok" };
  }

  // 3xx redirects — treat as ok (client follows redirects or server is live)
  logger.info(
    { event: "walkthrough.auth_probe_ok", context: "walkthrough", url: PROBE_URL },
    "session probe: session is valid",
  );
  return { kind: "ok" };
}

/** Prompt cURL paste loop — returns a parsed AuthSession or throws WalkthroughError. */
async function promptAndParseSession(logger: Logger): Promise<AuthSession> {
  for (let attempt = 0; attempt < MAX_PASTE_RETRIES; attempt++) {
    const paste = await editor({
      message: "No valid session found. Paste a cURL command with cookie headers (opens editor):",
    });

    let parsed: ReturnType<typeof parseCurl> | null = null;
    try {
      parsed = parseCurl(paste);
    } catch {
      // parseCurl throws AuthError on bad input — treat as invalid
    }

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

export interface RefreshSessionOptions {
  authPath: string;
  probeClientFactory: SessionProbeClientFactory;
  logger: Logger;
}

/**
 * Shared refresh flow used by both auth-check (stale branch) and withSessionRetry.
 * Deletes stale auth.json, prompts for a fresh cURL paste, persists it, and re-probes once.
 * Returns { ok: true, refreshed: true } on success.
 * Throws WalkthroughError if the second probe still fails.
 */
export async function refreshSession(opts: RefreshSessionOptions): Promise<AuthResult> {
  const { authPath, probeClientFactory, logger } = opts;

  // Do NOT unlink here — persistSession overwrites atomically via .tmp+rename.
  // Ctrl+C during the paste prompt would otherwise lose existing credentials before retry.
  const session = await promptAndParseSession(logger);
  await persistSession(session, authPath);
  logger.info(
    { event: "walkthrough.auth_refresh_persisted", context: "walkthrough", path: authPath },
    "stale session replaced — new auth saved",
  );

  // Re-probe once with a fresh client (reads new auth.json)
  const freshClient = await probeClientFactory();
  const retry = await probeSession(freshClient, logger);
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

  const session = await promptAndParseSession(opts.logger);
  await persistSession(session, authPath);
  opts.logger.info(
    { event: "walkthrough.auth_persisted", context: "walkthrough", path: authPath },
    "auth session saved",
  );
  return { ok: true, skipped: false, justAuthenticated: true };
}

/** Probes an existing session file, or prompts for a fresh cURL paste and probes that instead. */
async function checkAuthWithProbe(
  opts: AuthCheckOptions & { probeClientFactory: SessionProbeClientFactory },
  authPath: string,
): Promise<AuthResult> {
  if (isValidAuthFile(authPath)) {
    const client = await opts.probeClientFactory();
    const outcome = await probeSession(client, opts.logger);

    if (outcome.kind === "ok") {
      return { ok: true, skipped: false };
    }

    if (outcome.kind === "stale") {
      return refreshSession({
        authPath,
        probeClientFactory: opts.probeClientFactory,
        logger: opts.logger,
      });
    }

    if (outcome.kind === "network_error") {
      throw new WalkthroughError(
        `Could not reach Mangakakalot to verify session. Check connectivity. (${outcome.message})`,
      );
    }

    // transient 4xx/5xx — surface to caller, don't delete auth.json
    throw new WalkthroughError(
      `Mangakakalot returned an unexpected status (${outcome.status}) during session probe. Try again later.`,
    );
  }

  const session = await promptAndParseSession(opts.logger);
  await persistSession(session, authPath);
  opts.logger.info(
    { event: "walkthrough.auth_persisted", context: "walkthrough", path: authPath },
    "auth session saved",
  );

  // Re-reads the file we just wrote.
  const freshClient = await opts.probeClientFactory();
  const outcome = await probeSession(freshClient, opts.logger);
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
