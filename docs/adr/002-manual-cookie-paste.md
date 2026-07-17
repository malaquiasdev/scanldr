# ADR-002: Manual cURL Paste for Auth Capture

**Date:** 2026-05-05
**Status:** Accepted
**Supersedes:** ADR-001 (Playwright auth capture)
**Issue:** #58

## Context

ADR-001 adopted cookie replay as the download strategy and used Playwright (headful Chromium) to automate the `cf_clearance` capture step. Two failure modes were discovered in production (issue #58):

1. **Homepage does not trigger a CF challenge.** Navigating to `https://www.mangakakalot.gg` returns the page directly — no Turnstile, no `cf_clearance` cookie emitted. The Playwright flow "succeeded" silently, wrote an `auth.json` without `cf_clearance`, and then every download request failed with `CloudflareError`.

2. **Protected endpoint detects Playwright.** Navigating to `/search/story/…` (a Cloudflare-protected endpoint) does trigger a challenge, but Cloudflare's bot detection identifies the Playwright-controlled browser and serves an infinite "Just a moment…" page. The challenge is never resolved, `cf_clearance` is never issued.

Abandoned approaches explored in the spike:
- `playwright-stealth` plugin — still detected as of 2026-05.
- Waiting on `networkidle` — unreliable; CF JS keeps making background requests.
- Polling `cf_clearance` on the protected endpoint — the cookie never appears because the challenge loop never resolves for an automated browser.

## Decision

Replace the Playwright auth path entirely with a **manual cURL paste flow**:

1. `scanldr auth` prints step-by-step instructions directing the user to open the protected URL in their real browser and solve any CF challenge.
2. The user copies the verified request as cURL from DevTools (Chrome/Firefox/Safari all support this).
3. The user pastes the multi-line cURL into the terminal.
4. `scanldr auth` parses the cURL, validates presence of `cf_clearance` and `user-agent`, verifies the session with a plain fetch, and writes `auth.json` (mode 0600) in the same XDG location.

No Playwright dependency, no headful browser process. The `playwright` package is removed from `package.json`.

## Consequences

### Positive

- `cf_clearance` is guaranteed to be present — the real browser solved the challenge.
- No automation detection risk — the verification fetch uses the real user's cookies and UA.
- Removes a heavy build-time dependency (~100 MB Playwright + Chromium install).
- More transparent: the user sees exactly what is being captured.

### Negative

- Slightly more manual friction: user must open DevTools and copy a cURL. Steps are documented in `docs/auth-manual.md`.
- The copy-as-cURL format differs slightly between Chrome, Firefox, and Safari — the parser handles all three.
- Session still expires ~30 days out — no change vs. ADR-001.

## Implementation Detail: Session Probe Target

`checkAuth`'s session-validity probe (`walkthrough/steps/auth-check.ts`) targets the search endpoint (`/search/story/…`), not the homepage. As established above, the homepage never triggers a Cloudflare challenge and returns 200 regardless of session validity — probing it would give a false positive. The search endpoint enforces the same stricter CF rules the walkthrough hits in step 4, so a benign query returning a "no results" page confirms the session is genuinely valid, while a CF challenge confirms it is stale.

## Addendum (2026-07-16): browser cookie auto-extraction (Option B) — accepted for macOS/Chromium

The manual cURL-paste decision above stands as the baseline/fallback. A live spike (see [`docs/discovery/cf-cookie-autoextract-feasibility.md`](../discovery/cf-cookie-autoextract-feasibility.md)) showed a lower-friction path is feasible: open the site in the user's own browser, let the human solve Cloudflare, then auto-read + decrypt the domain-wide `cf_clearance` from the browser's cookie store. This keeps the same human-solves-CF, cookie-replay security posture without the browser-automation weight this ADR rejected.

**Status (issue #210): REMOVED.** This disk cookie-extract path never worked reliably in practice (`cf_clearance` staleness / Chrome flush-lag to the on-disk cookie DB — see [`docs/discovery/browser-auth-cf-bypass.md`](../discovery/browser-auth-cf-bypass.md)) and was superseded by the patchright browser-capture path below (issue #209), which reads cookies live from the browser context instead of a possibly-stale on-disk copy. The `browser-cookie/` integration and its walkthrough wiring have been deleted; patchright browser-capture is now the primary auth path, with manual cURL paste as the fallback.

## Addendum (2026-07-16): undetected-browser capture via patchright (Option C) — accepted as the primary auth path

A follow-up spike (see [`docs/discovery/browser-auth-cf-bypass.md`](../discovery/browser-auth-cf-bypass.md)) demonstrated that `patchright` (a drop-in Playwright fork that patches the automation-detection leaks) can launch a real Chrome undetected, allowing the user to solve Cloudflare interactively in a headed browser window. This combines the best of both prior approaches:
- **vs. ADR-001 (Playwright):** No automation detection; the browser is real, not headless.
- **vs. ADR-002 addendum (disk-extract):** Fresh `cf_clearance` directly from the live browser, not stale from disk.
- **vs. manual paste:** Same human-solves-CF UX, but zero manual copy-paste friction — `cf_clearance` is auto-harvested from the browser context once solved.

**Status (issue #208): implemented and integrated as the primary walkthrough auth path.** When a session probe detects staleness, the walkthrough now:
1. Attempts to launch Chrome via patchright, open the probe URL, and wait for the human to solve Cloudflare.
2. Harvests the fresh `cf_clearance` + exact user-agent from the browser context.
3. Validates the captured session via the existing probe.
4. Persists to `auth.json` on probe success.
5. Falls back to manual cURL paste on any failure (no Chrome, user cancels, capture error, or probe validation failure).

Implementation notes:
- `patchright` is a Playwright fork with patched automation-detection leaks; it drives the user's installed Chrome (`channel: "chrome"`, uses local executable).
- Opens the same probe-target URL (search endpoint) that the walkthrough uses to validate sessions — this ensures a fresh `cf_clearance` covers all operations.
- Targets the live browser context (user may solve a Turnstile in the window); no disk-read, no decryption, no UAderivation fragility — just read what the real browser captured.
- The browser launcher is seamed for testability — tests mock the seam and never launch a real Chrome.
- Manual cURL paste remains the fallback (used automatically on capture failure, no user configuration needed).
- `browser-cookie/` (#202 disk-extract) was removed in issue #210 — see the addendum above.

