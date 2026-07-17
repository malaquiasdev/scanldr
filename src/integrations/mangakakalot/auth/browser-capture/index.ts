import type { Logger } from "../../../../plugins/logger/index.ts";
import type { BrowserLauncherDeps, CapturedSession } from "./types.ts";

export type { BrowserContext, BrowserLauncherDeps, CapturedSession } from "./types.ts";

// Launches Chrome via patchright, opens the probe URL, lets user solve CF,
// harvests cookies + UA, and returns them. Returns undefined on any failure
// (no Chrome, user cancels, capture error). Never validates or persists —
// the caller (auth-check.ts) is responsible for probing before persisting.
//
// Failures are logged but never surfaced as errors — they are treated as
// "try manual paste instead" signal by the caller.

export async function captureSessionViaBrowser(
  launcherDeps: BrowserLauncherDeps,
  url: string, // The probe URL (same endpoint the session probe uses)
  logger: Logger,
): Promise<CapturedSession | undefined> {
  logger.info(
    { event: "walkthrough.auth_capture_start", context: "walkthrough", url },
    "initiating browser session capture",
  );

  let browser: Awaited<ReturnType<BrowserLauncherDeps["launch"]>> | undefined;
  try {
    browser = await launcherDeps.launch();
    if (!browser) {
      logger.info(
        { event: "walkthrough.auth_capture_no_chrome", context: "walkthrough" },
        "Chrome browser is not available for capture",
      );
      return undefined;
    }

    await browser.goto(url);
    // Timeout at 5 minutes (300,000 ms) to let user solve CF challenge if presented
    await browser.waitForChallengeCleared(300000);

    const cookiesList = await browser.cookies();
    logger.info(
      {
        event: "walkthrough.auth_capture_cookies_retrieved",
        context: "walkthrough",
        count: cookiesList.length,
      },
      "cookies captured from browser context",
    );

    const cookiesRecord: Record<string, string> = {};
    for (const cookie of cookiesList) {
      cookiesRecord[cookie.name] = cookie.value;
    }

    const userAgent = await browser.userAgent();

    return {
      cookies: cookiesRecord,
      userAgent,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    logger.warn(
      { event: "walkthrough.auth_capture_failed", context: "walkthrough", message },
      "browser session capture failed, falling back",
    );
    return undefined;
  } finally {
    if (browser) {
      try {
        // Non-persistent context launched with no userDataDir — Playwright allocates
        // a temp profile dir and removes it automatically once browser.close() resolves.
        await browser.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        logger.error(
          { event: "walkthrough.auth_capture_close_failed", context: "walkthrough", message },
          "failed to close capture browser context, continuing",
        );
      }
    }
  }
}
