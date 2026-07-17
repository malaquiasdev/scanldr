// Production wiring for the browser-cookie auto-extract auth path (issue #202).
// Kept separate from auth-check.ts so tests can import that file without pulling in
// real shell/fs seams (`open`, Keychain, cookie-DB reads).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  CHROMIUM_BROWSERS,
  copyCookieDb,
  extractBrowserSession,
  isBrowserInstalled,
  listChromiumBrowserDefs,
  listProfiles,
  queryCookies,
  readAppVersion,
  removeTempFile,
} from "../../integrations/mangakakalot/auth/browser-cookie/index.ts";
import { readKeychainPassword } from "../../integrations/mangakakalot/auth/browser-cookie/keychain.ts";
import type { AuthSession } from "../../integrations/mangakakalot/auth/types.ts";
import { input } from "../prompts.ts";
import type { BrowserAutoExtractDeps } from "../types.ts";

const execFileAsync = promisify(execFile);
const DOMAIN_FILTER = "mangakakalot.gg";

/** Builds the real (production) BrowserAutoExtractDeps — never used directly in tests. */
export function buildBrowserAutoExtractDeps(): BrowserAutoExtractDeps {
  return {
    detectInstalledBrowser: () => {
      const installed = listChromiumBrowserDefs().find((def) => isBrowserInstalled(def));
      return installed?.id;
    },
    openBrowser: (browser, url) => {
      const def = CHROMIUM_BROWSERS[browser];
      // Fire-and-forget: `open` returns immediately once the app is launched/focused.
      // Swallow rejection (e.g. app missing / spawn error) — the "press Enter" + probe
      // still gate the flow, so a failed `open` shouldn't surface as an unhandled rejection.
      void execFileAsync("open", ["-a", def.appName, url]).catch(() => {});
    },
    waitForContinue: async (message) => {
      await input({ message });
    },
    extractSession: async (browser): Promise<AuthSession | undefined> => {
      const def = CHROMIUM_BROWSERS[browser];
      const result = await extractBrowserSession(
        {
          browser,
          domainFilter: DOMAIN_FILTER,
          deps: {
            readKeychainPassword,
            listProfiles,
            copyCookieDb,
            queryCookies,
            removeTempFile,
            readAppVersion,
            isBrowserInstalled,
          },
        },
        def,
      );
      if (!result) return undefined;
      return {
        cookies: result.cookies,
        userAgent: result.userAgent,
        savedAt: Date.now(),
      };
    },
  };
}
