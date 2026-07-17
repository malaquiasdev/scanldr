// Builds production BrowserCaptureDeps using the real patchright launcher
import patchright from "patchright";
import type { BrowserLauncherDeps } from "../../integrations/mangakakalot/auth/browser-capture/index.ts";
import type { BrowserCaptureDeps } from "../types.ts";
import { hasCloudflareChallengeMarkers } from "./cloudflare-markers.ts";

export function buildBrowserCaptureDeps(): BrowserCaptureDeps {
  const launcherDeps: BrowserLauncherDeps = {
    launch: async () => {
      try {
        const browser = await patchright.chromium.launch({
          headless: false,
          channel: "chrome",
        });
        if (!browser) return undefined;

        const context = await browser.newContext();
        const page = await context.newPage();

        // Wrap in a context object matching BrowserContext interface
        return {
          goto: async (url) => {
            await page.goto(url);
          },
          waitForChallengeCleared: async (timeoutMs) => {
            // Poll until challenge markers are gone AND cf_clearance is actually
            // issued — markers can disappear a beat before the cookie is set.
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
              const content = await page.content();
              if (!hasCloudflareChallengeMarkers(content)) {
                const cookies = await context.cookies();
                if (cookies.some((c) => c.name === "cf_clearance")) {
                  return;
                }
              }
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
            throw new Error("Challenge not cleared within timeout");
          },
          cookies: async () => await context.cookies(),
          userAgent: async () => await page.evaluate(() => navigator.userAgent),
          close: async () => {
            await page.close();
            await context.close();
            await browser.close();
          },
        };
      } catch {
        return undefined;
      }
    },
  };

  return { launcherDeps };
}
