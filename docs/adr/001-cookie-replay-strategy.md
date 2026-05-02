# ADR-001: Cookie Replay over Playwright Stealth

**Date:** 2026-04-24
**Status:** Accepted

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
