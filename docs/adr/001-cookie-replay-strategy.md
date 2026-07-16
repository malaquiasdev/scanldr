# ADR-001: Cookie Replay over Playwright Stealth

**Date:** 2026-04-24
**Status:** Superseded by ADR-002

> **Note (2026-05-05):** The Playwright-based auth capture described in this ADR was abandoned in issue #58. The homepage never triggers a CF challenge, so `cf_clearance` is never issued via that path. Navigating to a protected endpoint (`/search/…`) instead causes Cloudflare to detect Playwright and hang indefinitely. The auth strategy is still cookie replay, but the capture mechanism is now a manual cURL paste from the user's real browser. See [ADR-002](./002-manual-cookie-paste.md).

## Context

scanldr needs to bypass Cloudflare protection on mangakakalot.gg to fetch manga pages and images. Two approaches were evaluated:

1. **Playwright Stealth** — use `playwright-extra` + stealth plugin to automate the browser and have it solve Cloudflare challenges invisibly.
2. **Cookie Replay** — solve the Cloudflare Turnstile once manually in a real browser, save the `cf_clearance` cookie, and replay it on all subsequent HTTP requests.

## Decision

Use **Cookie Replay** as the primary strategy for all download traffic. Playwright is retained only for the `auth` command to automate the cookie extraction step (no more manual copy/paste from DevTools).

## Justification

### Why not Playwright Stealth?

Stealth plugins were tested against mangakakalot.gg and Cloudflare still blocked the automated browser. As of 2026, Cloudflare's bot detection has advanced beyond what open-source stealth patches can reliably defeat on all sites.

### Why Cookie Replay works

- The `cf_clearance` cookie is issued to a real browser after a human solves the Turnstile. It is bound to a specific `User-Agent`.
- Replaying this cookie + UA on plain HTTP requests is indistinguishable from a normal browser session making background requests.
- The cookie is valid for ~30 days, making the manual friction acceptable.

### Why Playwright for auth capture

Forcing the user to open DevTools, find the cookie, and copy/paste it is poor UX and error-prone. Playwright can open a headful browser, let the user solve the challenge naturally, and then extract the cookie automatically from the browser's cookie store — zero copy/paste.

## Consequences

### Positive

- Download traffic is pure HTTP — fast, stable, no browser overhead.
- Works reliably on mangakakalot.gg where stealth fails.
- Auth UX is simple: run `scanldr auth`, solve one challenge, done for 30 days.

### Negative

- Session expires every ~30 days — user must re-run `scanldr auth`.
- Cookie is site-specific. Each new site requires its own bypass study (documented in a new ADR).
- If Cloudflare changes how `cf_clearance` is validated (e.g. IP pinning), this strategy may break.

## Per-Site Strategy

Each additional site will be studied independently. The bypass method (cookie replay, alternative cookie, API endpoints without Cloudflare, etc.) will be documented in a dedicated ADR per site.

## Implementation Detail: Lazy mtime-Cache Re-read

The fallback HTTP client (`integrations/fallback-http/service.ts`) reads `auth.json` lazily on every request rather than once at construction, caching the parsed session keyed by the file's `mtimeMs`. Before each dispatch it stats the file; if the mtime is unchanged since the last load, the cached session is reused, otherwise the file is re-read and re-parsed. This ensures that when `refreshSession` writes new credentials to disk (see ADR-002), the very next request automatically picks them up without requiring a new client instance to be constructed.

## Implementation Detail: Per-Lane CF Short-Circuit Latch (#137)

The fallback HTTP client dispatches over two lanes: the site/cookie lane (`get`, used for HTML pages that need the replayed `cf_clearance` cookie) and the anonymous/CDN lane (`getAnonymous`, used for image fetches with no cookie attached). Each lane has its own CF short-circuit latch, instantiated independently via `createCfLatch()`.

When a request on a lane observes a Cloudflare rejection — either a `403` or a `200` response whose body is a CF challenge page — the lane's latch records the `auth.json` mtime at that moment. While that mtime still matches the file on disk, subsequent requests on the *same* lane skip the HTTP call entirely (no throttle, no fetch) and throw immediately. This prevents tens of seconds of queued tasks spamming 403s while the user is being prompted for a fresh cURL paste. The latch clears itself automatically the first time a request on its lane observes that the mtime has advanced, i.e. `refreshSession` has written new credentials to disk.

The two lanes are latched independently, never sharing state, because a 403 on the anonymous (cookie-less) image-CDN lane is usually a Referer/hotlink rejection specific to that request, NOT a stale site session — it must not short-circuit the cookie lane, and vice versa.
