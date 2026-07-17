// Run-scoped guard: the browser-capture launcher must fire AT MOST ONCE per
// walkthrough run (issue #208 P2). Without this, every session-retry (search,
// listChapters, fetchChapterInput...) that hits a stale-session refresh would
// relaunch Chrome, opening tabs endlessly.
import type { BrowserCaptureDeps } from "../types.ts";

/**
 * Wraps a BrowserCaptureDeps so its launcher only ever runs once (success OR
 * failure) for the lifetime of the returned instance. Subsequent invocations
 * resolve to `undefined` immediately — the standard "no browser available"
 * signal — so callers fall straight through to manual cURL paste without any
 * further browser activity.
 *
 * Must be constructed fresh per run (not module-global) so test isolation and
 * concurrent runs never share state.
 */
export function withCaptureOnce(deps: BrowserCaptureDeps): BrowserCaptureDeps {
  let hasAttempted = false;
  return {
    launcherDeps: {
      launch: async () => {
        if (hasAttempted) return undefined;
        hasAttempted = true;
        return deps.launcherDeps.launch();
      },
    },
  };
}
