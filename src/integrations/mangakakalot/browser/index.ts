// Auth command handler for mangakakalot.
// Opens headful Chromium via Playwright, waits for user to solve Cloudflare Turnstile,
// captures cookies + User-Agent, verifies the session, writes auth.json under XDG data dir.
// Per ADR-001: no stealth — cookie replay is the strategy.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
// resolveAuthPath lives in @plugins/auth-path — shared with fallback-http and future integrations.
import { resolveAuthPath } from "@plugins/auth-path/index.ts";
import { chromium } from "playwright";
import { AuthError } from "./types.ts";
import type { AuthSession, PollForClearanceOptions, RunAuthOptions } from "./types.ts";

export { AuthError } from "./types.ts";
export type { AuthSession, PollForClearanceOptions, RunAuthOptions } from "./types.ts";

const SITE_ROOT = "https://mangakakalot.gg";
const CF_COOKIE_TIMEOUT_MS = 120_000;
const CF_COOKIE_INTERVAL_MS = 1_000;
const VERIFY_TIMEOUT_MS = 15_000;

const SITE_TITLE_MARKER = "MangaKakalot";

/**
 * Returns true when the page has loaded real site content (no CF challenge).
 * Uses page.title() — available synchronously after domcontentloaded and does
 * not trigger extra JS evaluation races.
 * Not async: purely synchronous string check; no await needed.
 */
export function pageHasRealContent(title: string): boolean {
  return title.includes(SITE_TITLE_MARKER);
}

/**
 * Polls until the `cf_clearance` cookie appears in the browser context.
 * Extracted as a pure helper so it can be unit-tested without launching Chromium.
 *
 * Throws `AuthError` when the deadline expires without the cookie appearing.
 */
export async function pollForClearance(opts: PollForClearanceOptions): Promise<void> {
  const { getCookies, timeoutMs, intervalMs } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const cookies = await getCookies();
    if (cookies.some((c) => c.name === "cf_clearance")) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  // One final check in case the cookie appeared in the last interval.
  const finalCookies = await getCookies();
  if (finalCookies.some((c) => c.name === "cf_clearance")) return;

  throw new AuthError("Challenge not solved within timeout. No session saved.");
}

/**
 * Builds the headers object for the session-verify fetch.
 * Omits the Cookie header when `cookies` is empty so the request is sent
 * with no Cookie header at all — matching FallbackHttpClient behaviour (#21).
 * Exported for unit tests.
 */
export function buildVerifyHeaders(
  cookies: Record<string, string>,
  userAgent: string,
): Record<string, string> {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

  const headers: Record<string, string> = { "user-agent": userAgent };
  if (cookieHeader.length > 0) {
    headers.cookie = cookieHeader;
  }
  return headers;
}

/**
 * Runs the interactive auth flow:
 * 1. Opens headful Chromium.
 * 2. Navigates to SITE_ROOT.
 * 3a. If the page title contains "MangaKakalot", the site loaded without a
 *     Cloudflare challenge — skip the cf_clearance poll entirely.
 * 3b. Otherwise, polls until cf_clearance cookie is present (up to 120s).
 * 4. Extracts cookies + UA.
 * 5. Verifies session via plain fetch (single source of truth).
 * 6. Atomically writes auth.json with mode 0600 under the XDG data dir.
 *
 * Throws (exit non-zero) when:
 * - User closes the browser before settlement.
 * - cf_clearance cookie never appears within timeout (challenge branch only).
 * - Session verification fails.
 */
export async function runAuth(opts: RunAuthOptions): Promise<void> {
  const { logger } = opts;
  const outPath = resolveAuthPath(opts);

  logger.info(
    { event: "auth.launch", context: "browser" },
    "Launching Chromium — solve the Cloudflare challenge in the browser window.",
  );

  const browser = await chromium.launch({ headless: false });

  let browserClosed = false;
  browser.on("disconnected", () => {
    browserClosed = true;
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(SITE_ROOT, { waitUntil: "domcontentloaded" });

    // Wrap title() so a rejected promise becomes a typed AuthError.
    let title: string;
    try {
      title = await page.title();
    } catch (err) {
      throw new AuthError(
        `Failed to read page title: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const realContent = pageHasRealContent(title);

    if (realContent) {
      // Site loaded without a CF challenge — no cf_clearance will appear.
      logger.info(
        { event: "auth.no_challenge", context: "browser" },
        "Page loaded with real site content — skipping cf_clearance poll.",
      );
    } else {
      logger.info(
        { event: "auth.waiting", context: "browser" },
        "Waiting for you to solve the challenge…",
      );

      // Poll until cf_clearance cookie appears — networkidle is unreliable for Turnstile.
      // Uses pollForClearance helper so the logic is independently testable.
      await pollForClearance({
        getCookies: async () => {
          if (browserClosed) {
            throw new AuthError("Browser closed before challenge was resolved. No session saved.");
          }
          return context.cookies();
        },
        timeoutMs: CF_COOKIE_TIMEOUT_MS,
        intervalMs: CF_COOKIE_INTERVAL_MS,
      });

      if (browserClosed) {
        throw new AuthError("Browser closed before challenge was resolved. No session saved.");
      }
    }

    // Extract User-Agent from the browser context.
    const userAgent = await page.evaluate(() => navigator.userAgent);

    // Build cookies map from all cookies for the host.
    const rawCookies = await context.cookies(SITE_ROOT);
    const cookies: Record<string, string> = {};
    for (const c of rawCookies) {
      cookies[c.name] = c.value;
    }

    logger.info(
      { event: "auth.challenge_resolved", context: "browser" },
      "Challenge resolved. Verifying session…",
    );

    // Verify: plain fetch with captured cookies + UA must return 200.
    // The verify step is the spec'd source of truth (ADR/issue #40); no second gate needed.
    const verifyHeaders = buildVerifyHeaders(cookies, userAgent);

    const controller = new AbortController();
    const verifyTimer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

    let verifyOk = false;
    try {
      const res = await fetch(SITE_ROOT, {
        headers: verifyHeaders,
        signal: controller.signal,
      });
      verifyOk = res.ok;
    } finally {
      clearTimeout(verifyTimer);
    }

    if (!verifyOk) {
      throw new AuthError(
        "Session verification failed — server rejected the captured cookies. Re-run scanldr auth.",
      );
    }

    const session: AuthSession = {
      cookies,
      userAgent,
      savedAt: Date.now(),
    };

    await mkdir(dirname(outPath), { recursive: true, mode: 0o700 });
    await writeFile(outPath, JSON.stringify(session, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });

    if (Object.keys(cookies).length === 0) {
      logger.info(
        { event: "auth.saved_no_cookies", context: "browser" },
        "Session saved with no cookies — site is public; only User-Agent is being persisted.",
      );
    }

    logger.info(
      { event: "auth.saved", context: "browser", path: outPath },
      `Auth saved to ${outPath}. Valid for ~30 days.`,
    );
  } finally {
    if (!browserClosed) {
      await browser.close();
    }
  }
}
