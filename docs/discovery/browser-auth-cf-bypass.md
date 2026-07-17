# mangakakalot Cloudflare Auth Bypass — Discovery Report

**Date:** 2026-07-17
**Status:** Discovery complete — live spikes done, no code committed
**Recommendation:** Adopt an undetected-browser auth-capture (patchright, Bun-native) to obtain a FRESH `cf_clearance`, then replay via scanldr's existing Bun `fetch`. This is the only approach that worked against mangakakalot's current Cloudflare. Revisit ADR-002; the disk cookie-extract (#202/#206) is superseded.

## Executive summary

mangakakalot.gg auth started failing: scanldr's session probe returns "Cloudflare rejected — stale" and downloads fall back to manual cURL paste, which also increasingly fails. We investigated whether the wall was the user-agent, the TLS/JA3 fingerprint, the cookie-capture mechanism, or plain cookie staleness. UA fabrication was a real but unrelated bug (fixed, didn't help). JA3/TLS fingerprint was disproven with a live replay test. The actual root cause is cookie staleness: `cf_clearance` has a short validity window and the on-disk browser cookie store lags the live browser by minutes, so every disk-read or manually-pasted cookie is already expired by the time scanldr uses it. Vanilla Playwright cannot fix this because Cloudflare detects the automation and never issues a fresh clearance. Two undetected-browser spikes (nodriver/Python, patchright/Bun) both harvested a fresh `cf_clearance` and successfully replayed it externally with a 200. patchright is recommended because it is Bun-native and fits scanldr's stack without a Python sidecar.

## 1. Problem

mangakakalot.gg auth started failing: scanldr's session probe returns "Cloudflare rejected — stale" and downloads fall back to manual cURL paste, which also increasingly fails. Investigated whether the wall was the user-agent, TLS/JA3 fingerprint, cookie capture, or cookie staleness.

## 2. UA fabrication (#202 disk-extract bug, fixed in #205/#206) — did NOT fix the failure

The auto-extract derived a hardcoded `Chrome/124.0.0.0` UA for non-Chrome browsers. Fixed to prompt for the exact UA. This was a real bug but unrelated to the current auth failure.

## 3. JA3/TLS-fingerprint hypothesis — DISPROVEN

Decrypted a real Chrome `cf_clearance` + exact Chrome 150 UA, replayed via plain `urllib` AND `curl_cffi` with `impersonate="chrome"`: BOTH returned HTTP 403. If the wall were purely JA3, the Chrome-impersonation replay should have passed — it didn't, which pointed away from fingerprint as the root cause.

## 4. Cookie staleness / Chrome flush-lag — THE ACTUAL WALL

Every cookie read from the on-disk Chromium cookie store was ≥30 min old: Chrome buffers cookie writes in memory and flushes to the SQLite file lazily, so a just-solved `cf_clearance` is NOT on disk yet. `cf_clearance` has a short validity window, so the disk-read cookie was always already expired → 403. This is why both the disk-extract (#202) and manual paste fail: they replay a stale cookie.

## 5. Vanilla Playwright — DISPROVEN as capture

A clean Playwright-launched Chrome got an endless Cloudflare re-challenge (the human solves, CF never clears) because CF detects the automation (`navigator.webdriver` / CDP `Runtime.enable` leak). Confirmed by a marketing-but-technically-accurate industry article (Cloudflare v9 model weights JA4 + HTTP/2 frame ordering + automation signals; `playwright-stealth`/`undetected-chromedriver`/FlareSolverr all rated low pass-rate; paid residential+mobile-fingerprint services are the only ~95% path). `@cloudflare/playwright` is unrelated — it runs browsers ON Cloudflare Workers, not a bypass.

## 6. What WORKED — the decisive spikes

**nodriver (Python) spike:** launched a real Chrome undetected (no webdriver/CDP leak), passed CF with NO re-challenge (real 154KB content page), harvested a FRESH `cf_clearance` (len 639) + UA (`Chrome/150.0.0.0`). Then:
- in-browser search request → 200
- external replay of the fresh cookie via plain `urllib` (non-Chrome JA3) → 200
- via `curl_cffi` chrome-impersonate → 200

This PROVED: JA3 is not the wall; a FRESH `cf_clearance` replays fine via a plain HTTP client.

**patchright (Node/Bun-native) spike — the recommended path:** `patchright` (a drop-in Playwright fork that patches the `Runtime.enable`/automation-detection leaks) launched the installed Chrome via Bun, passed CF with NO re-challenge (203KB content), harvested a FRESH `cf_clearance` (len 789) + UA. Then:
- in-browser search → 200
- external replay of the fresh cookie via scanldr's actual Bun `fetch` → 200

Same result as nodriver, but Bun-native (no Python sidecar) — integrates with scanldr's stack.

## 7. Root cause

The failure was NEVER user-agent or TLS fingerprint. It was cookie staleness: scanldr (disk-extract and manual paste) replays a `cf_clearance` that is already expired by the time it's used, because (a) `cf_clearance` has a short validity and (b) the on-disk cookie lags the live browser (flush-lag). Vanilla Playwright can't help because CF detects the automation and never issues a fresh clearance. An undetected browser (nodriver / patchright) is the one thing that reliably obtains a FRESH `cf_clearance` past CF; once fresh, scanldr's existing Bun-fetch replay works (200).

## 8. Options considered

| Option | Mechanism | Works vs current CF? | Fit for scanldr |
|---|---|---|---|
| Manual cURL paste (current) | replay a copied cookie | Works ONLY if pasted within the short freshness window; fragile | Current, degrading |
| Disk cookie-extract (#202/#206) | read + decrypt from browser store | FAILS (flush-lag → stale) + Keychain friction | Superseded |
| Vanilla Playwright | automated browser, no patching | FAILS (automation-detected, endless re-challenge) | Not viable |
| TLS-impersonation only (curl_cffi/curl-impersonate) | JA3 spoof on replay | Can't solve the JS challenge; only helps replay, and replay already works when fresh | Not sufficient alone |
| nodriver (Python) | undetected real Chrome | WORKS | Python sidecar, off-stack |
| patchright (Bun/Node) | undetected real Chrome, Bun-native | WORKS | Recommended |
| Paid managed browser + residential proxy | commercial anti-detect service | ~95% | $/min + proxies — inappropriate for a free local CLI |

## 9. Recommendation & next steps

Adopt patchright (Bun-native) as the auth-capture: launch the real Chrome headed, user solves CF if a Turnstile appears (often auto-passes IUAM), harvest the fresh `cf_clearance` + exact UA, persist to `auth.json`, and let scanldr's existing Bun `fetch` replay it. Because the clearance is short-lived, capture should happen just-in-time (re-capture when the probe reports stale) rather than relying on a long-lived stored session. Trade-offs: adds patchright + requires a local Chrome (heavier than cURL paste — revisit ADR-002). The disk cookie-extract (#202/#206) is superseded and should be reverted. Note the image CDN lane is unaffected (referer-based, no `cf_clearance`).

## References

- [`docs/adr/002-manual-cookie-paste.md`](../adr/002-manual-cookie-paste.md)
- [`docs/adr/001-cookie-replay-strategy.md`](../adr/001-cookie-replay-strategy.md)
- Shared HTTP client: [`src/integrations/fallback-http/service.ts`](../../src/integrations/fallback-http/service.ts) (uses `globalThis.fetch`)
- Superseded #202 extract: [`src/integrations/mangakakalot/auth/browser-cookie/`](../../src/integrations/mangakakalot/auth/browser-cookie/)
- Tools: [nodriver](https://github.com/ultrafunkamsterdam/nodriver), [patchright](https://www.npmjs.com/package/patchright) (npm), [curl_cffi](https://github.com/yifeikong/curl_cffi)
