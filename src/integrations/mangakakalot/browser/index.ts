// Auth command handler for mangakakalot.
// Opens headful Chromium via Playwright, waits for user to solve Cloudflare Turnstile,
// captures cookies + User-Agent, verifies the session, writes .scanldr-auth.json.
// Per ADR-001: no stealth — cookie replay is the strategy.

import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { AuthError } from "./types.ts";
import type { AuthSession, RunAuthOptions } from "./types.ts";

export { AuthError } from "./types.ts";
export type { AuthSession, RunAuthOptions } from "./types.ts";

const AUTH_FILE = ".scanldr-auth.json";
const SITE_ROOT = "https://mangakakalot.gg";
const CF_COOKIE_TIMEOUT_MS = 120_000;
const VERIFY_TIMEOUT_MS = 15_000;

/**
 * Runs the interactive auth flow:
 * 1. Opens headful Chromium.
 * 2. Navigates to SITE_ROOT — user solves the Turnstile.
 * 3. Polls until cf_clearance cookie is present (up to 120s).
 * 4. Extracts cookies + UA.
 * 5. Verifies session via plain fetch.
 * 6. Writes .scanldr-auth.json with mode 0600.
 *
 * Throws (exit non-zero) when:
 * - User closes the browser before settlement.
 * - cf_clearance cookie never appears within timeout.
 * - Session verification fails.
 */
export async function runAuth(opts: RunAuthOptions): Promise<void> {
  const { logger } = opts;
  const cwd = opts.cwd ?? process.cwd();

  logger.info({}, "Launching Chromium — solve the Cloudflare challenge in the browser window.");

  const browser = await chromium.launch({ headless: false });

  let browserClosed = false;
  browser.on("disconnected", () => {
    browserClosed = true;
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(SITE_ROOT, { waitUntil: "domcontentloaded" });

    logger.info({}, "Waiting for you to solve the challenge…");

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

    logger.info({}, "Challenge resolved. Verifying session…");

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

    const outPath = join(cwd, AUTH_FILE);
    await writeFile(outPath, JSON.stringify(session, null, 2), { encoding: "utf8" });
    await chmod(outPath, 0o600);

    logger.info({}, `Auth saved to ${AUTH_FILE}. Valid for ~30 days.`);
  } finally {
    if (!browserClosed) {
      await browser.close();
    }
  }
}
