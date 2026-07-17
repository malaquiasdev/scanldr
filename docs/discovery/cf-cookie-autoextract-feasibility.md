> **Superseded.** Option B (disk cookie-extract) was implemented in #202 and removed in #210
> (`cf_clearance` staleness / Chrome flush-lag to the on-disk cookie DB). See
> [`browser-auth-cf-bypass.md`](browser-auth-cf-bypass.md) and the ADR-002 addenda for the
> patchright undetected-browser-capture outcome that replaced it. Body below kept as the dated
> record.

# cf_clearance Auto-Extraction Feasibility — Discovery Report

**Date:** 2026-07-16
**Status:** Discovery complete + live spike done — no code committed
**Recommendation:** Option B (open browser + auto-read `cf_clearance` from the local browser cookie store) is feasible and materially lower-friction than the current DevTools cURL-paste; recommend it as a follow-up, with the user-agent caveat below. Revisit ADR-002.

## Context

Today's auth (ADR-002) requires the user to open DevTools, copy a cURL with the `cf_clearance` cookie + user-agent, and paste it into scanldr. The friction is the manual copy every time the clearance expires (~30 days). This discovery explores whether that friction can be reduced while keeping the human-solves-Cloudflare property — no bot/stealth, sidestepping the anti-bot arms race ADR-002 already rejected.

## Options considered

| Option | How | UX simplicity | Robustness | Fits ADR-002 spirit |
|---|---|---|---|---|
| A — controlled headed browser (Playwright) | Launch a visible browser, human solves CF, read cookies programmatically | Clean cookie+UA harvest in one step | High — direct control of both cookie and UA | Partial — reintroduces the ~150 MB browser dependency ADR-002 removed. No stealth needed since a human solves it |
| **B — open in the user's own browser + read `cf_clearance` from its cookie store** | `open <url>`, human solves, scanldr reads the cookie from disk | No browser dependency; one confirm step | Medium — per-OS encrypted-cookie decrypt + UA is not co-located with the cookie | Best fit — no automation, no new dependency, same replay posture as today |
| TLS-fingerprint client (curl-impersonate / tls-client) | No browser, matches Chrome JA3/JA4 | N/A (no human step) | Only passes passive IUAM, not interactive Turnstile | Doesn't apply — mangakakalot issues `cf_clearance` interactively, so fingerprint-only is insufficient |
| FlareSolverr / headless stealth | Runs a headless Chromium to solve challenges automatically | High (fully automated) | Robust today, but is exactly the browser-automation arms race | Rejected — this IS the approach ADR-002 rejected |

**Recommended: Option B.**

## The live spike (Option B, verified end-to-end on macOS 26.5.2)

Environment: no Chrome/Firefox present on disk; the user's browsers are Opera 133 and Safari.

Steps proven:

1. `open -a Opera "https://www.mangakakalot.gg/"` launched the site — no automation, no stealth.
2. The human solved the Cloudflare challenge in the visible window.
3. A domain-wide `cf_clearance` cookie appeared in Opera's cookie store — `host_key = .mangakakalot.gg` (leading dot = whole domain), encrypted_value ~611 bytes, `v10` scheme (standard Chromium AES). Because it is domain-scoped, it covers search/detail/chapter — the specific page the user lands on to solve CF is irrelevant.
4. Read Opera's cookie SQLite (`~/Library/Application Support/com.operasoftware.Opera/Default/Cookies`), decrypted the `cf_clearance` via the standard Chromium/macOS path: Keychain item "Opera Safe Storage" → PBKDF2(sha1, salt "saltysalt", 1003 iters, 16-byte key) → AES-128-CBC (IV = 16×0x20), strip PKCS7 + the 32-byte SHA256 domain-hash prefix. Result: a valid 575-char ASCII `cf_clearance` token. (Reading the Keychain triggers a one-time macOS "allow" prompt; supports "always allow".)

## The user-agent caveat (the real friction)

`cf_clearance` is bound to the browser's user-agent (+ IP/TLS). scanldr replays via Bun `fetch`, so it must send the SAME UA the browser used. The UA is NOT stored in the cookie DB. Options: derive from the browser version (needs an OPR/Chrome→UA mapping, fragile), a one-line "confirm your UA" step, or fall back to Option A (a controlled browser yields the exact UA for free). Note the current paste flow already captures the UA from the pasted cURL, so scanldr already needs and knows a UA — this only changes how it's obtained.

## Cross-OS / robustness notes

- Chromium cookie decrypt is per-OS: macOS Keychain (`"<Browser> Safe Storage"`), Windows DPAPI, Linux libsecret/kwallet. Firefox stores cookies unencrypted (`cookies.sqlite`) — easiest. Safari uses `Cookies.binarycookies` (parseable, unencrypted, but sandboxed/TCC).
- The image CDN is a separate CF zone using the referer/hotlink anonymous lane (no `cf_clearance`) — unchanged; this only affects the site (search/detail/chapter) lane.
- Security posture is identical to today's cookie replay (ADR-001): the app already stores/replays a `cf_clearance`; this only automates its capture. It reads the user's own browser cookies on the user's own machine.

## Recommendation

Option B as a lower-friction alternative to the DevTools paste, guarded behind the UA-capture decision. Flow: scanldr `open`s the (search or any) URL → user solves CF → "press Enter when done" → scanldr reads + decrypts `cf_clearance` from the browser store, pairs it with the matching UA, persists to `auth.json` exactly like the paste flow. Keep the manual paste as the fallback. Prototype the macOS Opera/Chrome path + the UA derivation first (riskiest parts).

## References

- [ADR-001: Cookie Replay over Playwright Stealth](../adr/001-cookie-replay-strategy.md)
- [ADR-002: Manual cURL Paste for Auth Capture](../adr/002-manual-cookie-paste.md)
- [`src/plugins/auth-path/`](../../src/plugins/auth-path/)
- [`src/integrations/mangakakalot/auth/`](../../src/integrations/mangakakalot/auth/) — current cURL-paste parser
- ADR-002 should be revisited in light of this spike.
