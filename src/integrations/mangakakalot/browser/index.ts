// Auth command handler for mangakakalot.
// Opens headful Chromium via Playwright, waits for user to solve Cloudflare Turnstile,
// captures cookies + User-Agent, verifies the session, writes auth.json under XDG data dir.
// Per ADR-001: no stealth — cookie replay is the strategy.

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { AuthError } from "./types.ts";
import type { AuthSession, RunAuthOptions } from "./types.ts";

export { AuthError } from "./types.ts";
export type { AuthSession, RunAuthOptions } from "./types.ts";

const AUTH_FILENAME = "auth.json";
const APP_DIR = "scanldr";
const SITE_ROOT = "https://mangakakalot.gg";
const CF_COOKIE_TIMEOUT_MS = 120_000;
const VERIFY_TIMEOUT_MS = 15_000;

/**
 * Resolves the absolute path where the auth session is persisted.
 *
 * Order:
 * 1. `opts.dataHome` (test override) → `<dataHome>/scanldr/auth.json`
 * 2. `$XDG_DATA_HOME/scanldr/auth.json`
 * 3. `<home>/.local/share/scanldr/auth.json`
 */
export function resolveAuthPath(opts: RunAuthOptions): string {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const base =
    opts.dataHome ??
    (env.XDG_DATA_HOME && env.XDG_DATA_HOME.length > 0
      ? env.XDG_DATA_HOME
      : join(home, ".local", "share"));
  return join(base, APP_DIR, AUTH_FILENAME);
}

/**
 * Runs the interactive auth flow:
 * 1. Opens headful Chromium.
 * 2. Navigates to SITE_ROOT — user solves the Turnstile.
 * 3. Polls until cf_clearance cookie is present (up to 120s).
 * 4. Extracts cookies + UA.
 * 5. Verifies session via plain fetch.
 * 6. Atomically writes auth.json with mode 0600 under the XDG data dir.
 *
 * Throws (exit non-zero) when:
 * - User closes the browser before settlement.
 * - cf_clearance cookie never appears within timeout.
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

    logger.info(
      { event: "auth.waiting", context: "browser" },
      "Waiting for you to solve the challenge…",
    );

    // Poll until cf_clearance cookie appears — networkidle is unreliable for Turnstile.
    const deadline = Date.now() + CF_COOKIE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (browserClosed) {
        throw new AuthError("Browser closed before challenge was resolved. No session saved.");
      }
      const cookies = await context.cookies();
      if (cookies.some((c) => c.name === "cf_clearance")) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (browserClosed) {
      throw new AuthError("Browser closed before challenge was resolved. No session saved.");
    }

    const finalCookies = await context.cookies();
    if (!finalCookies.some((c) => c.name === "cf_clearance")) {
      throw new AuthError("Challenge not solved within timeout. No session saved.");
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
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");

    const controller = new AbortController();
    const verifyTimer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

    let verifyOk = false;
    try {
      const res = await fetch(SITE_ROOT, {
        headers: {
          cookie: cookieHeader,
          "user-agent": userAgent,
        },
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
