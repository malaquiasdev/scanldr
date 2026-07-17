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

**Status (issue #202): implemented for macOS + Chromium browsers (Chrome, Opera, Brave, Edge).** Offered as the primary walkthrough auth option; manual cURL paste remains the fallback (used automatically on any auto-extract failure — browser not found, no `cf_clearance`, or failed probe validation).

Implementation notes:
- Cookie DB located per browser under `~/Library/Application Support/...`, copied to a temp file (the live DB may be locked), queried via `bun:sqlite`, then the temp copy is deleted.
- `v10`-scheme values decrypted with `node:crypto` (PBKDF2 + AES-128-CBC), keyed by the browser's "`<Browser> Safe Storage`" macOS Keychain item (`security find-generic-password`). No Playwright, no new dependency.
- Multi-profile handling: the profile with the freshest `cf_clearance` (by `creation_utc`) wins.
- **User-agent**, the open question above, is resolved as a best-effort derivation from the browser's own app version (`CFBundleShortVersionString`) — see `src/integrations/mangakakalot/auth/browser-cookie/ua.ts`. This is the fragile part, which is why the extracted session is **always validated via the existing session probe before being persisted**; any validation failure (stale, wrong UA, CF rejection) falls back to manual paste rather than silently persisting a broken session.
- Firefox, Safari, Windows (DPAPI), and Linux (libsecret/kwallet) are explicit out-of-scope follow-ups.
