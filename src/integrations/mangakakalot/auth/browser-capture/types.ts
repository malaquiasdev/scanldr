/** Seam for launching and managing the browser (patchright in production, mocked in tests). */
export interface BrowserLauncherDeps {
  /**
   * Launch a headful Chrome via patchright. Returns undefined if Chrome not available.
   * Production: uses patchright.chromium.launch({ headless: false, channel: 'chrome' })
   * Tests: mock to return a fake browser handle.
   */
  launch: () => Promise<BrowserContext | undefined>;
}

export interface BrowserContext {
  /** Go to the specified URL. Resolves when the page is loaded. */
  goto: (url: string) => Promise<void>;
  /**
   * Poll until the CF challenge is cleared. Check for these markers:
   * - "real" content (NOT "Just a moment" or CF challenge HTML)
   * - Absence of CF challenge markers (cf-browser-verification, challenge-platform, cdn-cgi/challenge-platform, jschl-answer)
   * Returns when real content is present.
   */
  waitForChallengeCleared: (timeoutMs: number) => Promise<void>;
  /** Read all cookies from the context. Returns { name, value } for each. */
  cookies: () => Promise<Array<{ name: string; value: string }>>;
  /** Read navigator.userAgent from the page context. */
  userAgent: () => Promise<string>;
  /** Close the browser. Best-effort cleanup. */
  close: () => Promise<void>;
}

/** Captured session data (shape matches AuthSession). */
export interface CapturedSession {
  cookies: Record<string, string>;
  userAgent: string;
}
