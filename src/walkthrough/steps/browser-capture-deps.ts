import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasCloudflareChallengeMarkers } from "@integrations/_shared/cloudflare.ts";
import patchright from "patchright";
import type { BrowserLauncherDeps } from "../../integrations/mangakakalot/auth/browser-capture/index.ts";
import type { BrowserCaptureDeps } from "../types.ts";

/**
 * Standard macOS Chrome install path. patchright's stealth patches target the real
 * Chrome binary (not the Playwright-bundled Chromium), so we prefer this explicit
 * path when present and otherwise fall back to `channel: "chrome"` resolution.
 */
const MACOS_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function resolveChromeExecutablePath(): string | undefined {
  return existsSync(MACOS_CHROME_PATH) ? MACOS_CHROME_PATH : undefined;
}

type PersistentContext = Awaited<ReturnType<typeof patchright.chromium.launchPersistentContext>>;
type ContextPage = ReturnType<PersistentContext["pages"]>[number];

/** Wraps the patchright persistent context + page into the BrowserContext interface. */
function buildBrowserContext(ctx: PersistentContext, page: ContextPage, userDataDir: string) {
  return {
    goto: async (url: string) => {
      await page.goto(url);
    },
    /**
     * Polls until challenge markers are gone AND cf_clearance is actually issued —
     * markers can disappear a beat before the cookie is set.
     */
    waitForChallengeCleared: async (timeoutMs: number) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const content = await page.content();
        if (!hasCloudflareChallengeMarkers(content)) {
          const cookies = await ctx.cookies();
          if (cookies.some((c) => c.name === "cf_clearance")) {
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error("Challenge not cleared within timeout");
    },
    cookies: async () => await ctx.cookies(),
    userAgent: async () => await page.evaluate(() => navigator.userAgent),
    close: async () => {
      try {
        await ctx.close();
      } finally {
        // Best-effort cleanup: the temp profile dir is single-use, never reopened.
        if (userDataDir) {
          await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    },
  };
}

/** Builds production BrowserCaptureDeps using the real patchright launcher. */
export function buildBrowserCaptureDeps(): BrowserCaptureDeps {
  const launcherDeps: BrowserLauncherDeps = {
    launch: async () => {
      let userDataDir: string | undefined;
      try {
        // patchright's stealth evasion requires a PERSISTENT context — a plain
        // browser.newContext() re-triggers the Cloudflare challenge on every
        // navigation and waitForChallengeCleared never resolves.
        userDataDir = await mkdtemp(join(tmpdir(), "scanldr-browser-capture-"));

        const executablePath = resolveChromeExecutablePath();
        const ctx = await patchright.chromium.launchPersistentContext(userDataDir, {
          channel: "chrome",
          ...(executablePath ? { executablePath } : {}),
          headless: false,
          viewport: null,
        });

        const page = ctx.pages()[0] ?? (await ctx.newPage());

        return buildBrowserContext(ctx, page, userDataDir);
      } catch {
        // Launch failed before a context existed — clean up the temp dir if it was created.
        if (userDataDir) {
          await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
        }
        return undefined;
      }
    },
  };

  return { launcherDeps };
}
