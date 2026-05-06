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
