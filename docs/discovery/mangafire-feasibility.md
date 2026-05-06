# MangaFire.to Feasibility — Discovery Report (Phase 1)

**Date:** 2026-05-06
**Issue:** [#78](https://github.com/malaquiasdev/scanldr/issues/78)
**Status:** Discovery only — read-only probes, no code committed
**Recommendation:** **B) Engavetar** (gate falls on VRF, see Q1 + Q3)

## Executive summary

MangaFire as a second fallback is **not viable under the cookie-paste constraint set by [ADR-002](../adr/002-manual-cookie-paste.md)**. Every page-fetch endpoint (`/ajax/read/...`) is gated by **VRF tokens** computed at runtime by obfuscated JS served from `mfcdn.cc`. They are not stored in cookies and not derivable from chapter ids. The reference Python scraper [`f4rh4d-4hmed/MangaFire-API`](https://github.com/f4rh4d-4hmed/MangaFire-API) needs a Playwright two-pass intercept plus a Pillow tile-descrambler. The Node port [`shafat-96/mangafire`](https://github.com/shafat-96/mangafire) does not handle VRF — its hardcoded cookie returns `Request is invalid.` today. Coverage versus mangakakalot is roughly equivalent for the popular shounen catalog, so the marginal robustness gain does not justify reverting [ADR-002](../adr/002-manual-cookie-paste.md). Close issue #78. Track partner-source candidates in [#53](https://github.com/malaquiasdev/scanldr/issues/53) instead.

## Q1 — VRF token strategy

**Answer: (c) generated dynamically per-page-load via obfuscated JS — RED.**

1. Chapter-list endpoint is open: `GET /ajax/manga/<hid>/chapter/<lang>` returns the index unauthenticated. Probed against `dkw` (One Piece), `3r5x9` (Dandadan), `0w5k` (Chainsaw Man), `m2vv` (Berserk), `zpw` (Vinland Saga) — all 200 OK.
2. Page-list endpoint is closed without a token. With `User-Agent` + `Referer` + `X-Requested-With: XMLHttpRequest`:
   ```
   GET /ajax/read/chapter/1
   → {"status":403,"result":null,"message":"Request is invalid."}
   ```
   Same response with shafat-96's hardcoded `cf_clearance` ([`src/utils/axios.ts`](https://github.com/shafat-96/mangafire/blob/main/src/utils/axios.ts), cookie issued 2025-04-11). The 403 is application-level (JSON envelope routed through the origin's PHP), confirming the cookie reached the app and the app rejected for missing the VRF parameter.
3. The Python reference ([`app.py:380-650`](https://github.com/f4rh4d-4hmed/MangaFire-API/blob/main/app.py)) documents the exact mechanism: `VRFHelper` boots Playwright Chromium, navigates to the chapter URL, intercepts the first `ajax/read/<hid>/<type>/<lang>?vrf=<token>` request, fulfils it from a pre-fetched cache to outrun the site's anti-bot redirect, then captures the second `ajax/read/chapter/<id>?vrf=<token2>`. Both tokens are produced by the reader JS bundle on `mfcdn.cc`. They cannot be replayed across requests and cannot be computed from the chapter id alone — the JS pulls in CF Turnstile state (captcha key `0x4AAAAAAA9HVepYlLLsGrEj` injected on every page).

A cookie paste captures `cf_clearance` and any session cookie, but produces no VRF and cannot replay one. The [ADR-002](../adr/002-manual-cookie-paste.md) flow does not extend here.

## Q2 — Cloudflare gating

| URL | Status | Notes |
|---|---|---|
| `GET /` | 200 | Open. Loads CF Turnstile + `mfcdn.nl` scripts.js. No challenge UI. |
| `GET /home`, `/updated`, `/genre/<g>`, `/type/manga` | 200 | All open. |
| `GET /manga/one-piecee.dkw` | 200 | Detail page incl. server-rendered chapter list. |
| `GET /read/<slug>/en/chapter-1` | 200 | Reader shell open; page-images list fetched via JS+VRF. |
| `GET /sitemap.xml`, `sitemap-list-1..54.xml` | 200 | ~54k manga indexed. |
| `GET /ajax/manga/<hid>/chapter/<lang>` | 200 | Open. No XHR header required, no cookie required. |
| `GET /filter?keyword=dandadan` | **403** | Origin-level. Same on POST. Same with `X-Requested-With`. |
| `GET /ajax/manga/search?keyword=...` | **403** | `{"status":403,"result":null,"message":"Request is invalid."}` |
| `GET /ajax/read/chapter/<id>` | **403** | Same envelope. Requires `?vrf=...`. |

CF fronts the whole zone (`server: cloudflare`, `cf-ray: 9f774…`) but does not present a JS challenge for read paths — gating is the origin's app router rejecting requests without VRF. **Stronger** than mangakakalot.gg, where `cf_clearance` alone unblocks `/search/story` + `/manga/<id>`.

## Q3 — Endpoint surface (current truth table)

Verified by direct cURL from this session:

| Operation | URL | Auth | Returns |
|---|---|---|---|
| Homepage | `GET /` | none | HTML shell |
| Updates | `GET /updated` | none | HTML grid (slugs `<title>.<id>`) |
| Genre browse | `GET /genre/<name>` | none | HTML grid + paging |
| Manga detail | `GET /manga/<slug>` | none | HTML w/ `data-hid="<id>"`, server-rendered chapter `<li>` list |
| Chapter list (AJAX) | `GET /ajax/manga/<hid>/chapter/<lang>` | none | JSON `{result:"<ul>...<li data-id=N data-number=X>...</li></ul>"}` |
| Volume list (AJAX) | `GET /ajax/manga/<hid>/volume/<lang>` | none | JSON, same envelope |
| Reader shell | `GET /read/<slug>/<lang>/chapter-<num>` | none | HTML with `data-id="<chapterDbId>"` |
| **Reader page-list** | `GET /ajax/read/chapter/<id>?vrf=<token>` | **VRF** | JSON `{result:{images:[[url,?,offset]…]}}` — blocked without token |
| Search (HTML) | `GET /filter?keyword=<q>` | **anti-bot** | 403 origin |
| Search (AJAX) | `GET /ajax/manga/search?keyword=...&vrf=<token>` | **VRF** | 403 without token |
| Sitemap | `GET /sitemap.xml` + `sitemap-list-N.xml` | none | XML, ~54k canonical manga URLs |

Community references, accuracy as of today:

- **shafat-96/mangafire** — endpoint set is correct (`/ajax/read/<hid>/chapter/<lang>` mirrors `/ajax/manga/<hid>/chapter/<lang>`), but the hardcoded cookie is dead and the code does **not** handle VRF; it would only work for chapter listing.
- **f4rh4d-4hmed/MangaFire-API** — endpoints match; explicitly requires Playwright. README: "No pages found. Try with `use_browser=true` for VRF bypass."
- **KanekiCraynet/api-manga**, **manga-collector** — proxy similar patterns; not independently verified.

## Q4 — Image referer / hotlink protection

Could not exercise the image fetch path (page-list is VRF-gated). Reading [`f4rh4d-4hmed/MangaFire-API/app.py:215-280`](https://github.com/f4rh4d-4hmed/MangaFire-API/blob/main/app.py):

- Image URLs live on a CDN (the source uses `https://static.mfcdn.nl/...` for asset URLs already observed; the page-image CDN may differ).
- Reference scraper sets `Referer: https://mangafire.to/` on every CDN fetch.
- **Images are tile-shuffled.** Each page entry is `[url, ?, offset]`; the Python implementation runs a Pillow descrambler with `PIECE_SIZE=200, MIN_SPLIT_COUNT=5` and the inverse shuffle `(x_max - x + offset) % x_max`. Without descrambling, downloaded JPEGs are unreadable.

Net: even after solving VRF we would need a JS image descrambler. There is no `bun:image` builtin; we would pull in `sharp` (~30 MB binary) just for this site.

## Q5 — Coverage comparison (sample series)

MangaFire counts pulled live today via the open `/ajax/manga/<hid>/chapter/en` endpoint. Mangakakalot.gg counts not re-probed today (current `auth.json` is expired with `STATUS=403 Just a moment…`). Mangakakalot coverage is taken from prior issue context (#57, #59) and from the existing `src/integrations/mangakakalot/` parser exercised against these slugs.

| Series | mangakakalot.gg | mangafire.to | MF latest | MF chapters |
|---|---|---|---|---|
| Dandadan | yes | yes (`dandadann.3r5x9`) | ch.232 (2026-05-05) | 243 |
| Chainsaw Man | yes | yes (`chainsaw-mann.0w5k`) | ch.232 | 293 |
| Berserk | yes | yes (`berserkk.m2vv`) | ch.383 | 429 |
| Vinland Saga | yes | yes (`vinland-sagaa.zpw`) | ch.220 | 325 |
| One Piece | yes | yes (`one-piecee.dkw`) | ch.1181 (2026-04-28) | 1233 |
| Jujutsu Kaisen | yes | yes (`jujutsu-kaisen-00.3rn99` + alt slugs) | not measured | not measured |
| Spy x Family | yes | yes (multiple slugs) | not measured | not measured |

Coverage of the popular shounen set is a **wash**. MangaFire offers richer side-content (doujin, spinoffs — "Spy x Family Anya and Damian", "Chainsaw Man 22", "Jujutsu Kaisen 0") that mangakakalot does not, but those are tangential to the user's `all_external` flow. MangaFire as a fallback would mostly serve as an **availability hedge** — real but bounded value.

## Probes with unexpected results worth flagging

- `/filter` returns the homepage `<head>` with status 403. Response body is full app shell, not a CF challenge page. Easy to mis-parse as success.
- The captcha key `0x4AAAAAAA9HVepYlLLsGrEj` is hardcoded in inline `<script>` on every page. Indicates Turnstile is invoked on demand (likely on form submits and on `/ajax/manga/search`), not as an interstitial.
- `/ajax/read/<hid>/chapter/<lang>` and `/ajax/manga/<hid>/chapter/<lang>` both return chapter lists today — community libs use the former, our probe used the latter. Either works.
- shafat-96's hardcoded cookie is dead. Anyone copying that repo today gets 403 on every page-fetch even with a fresh `cf_clearance` paste, confirming the gate is VRF, not CF.

## Recommendation — B) Engavetar

Do not implement MangaFire as a second fallback under the current architectural constraints:

1. **VRF wall is non-negotiable.** Page-fetch — the *only* operation that matters for downloads — requires Playwright with a two-pass intercept. [ADR-002](../adr/002-manual-cookie-paste.md) explicitly removes Playwright; reverting it for one fallback site is poor trade.
2. **Image descrambling adds a second native dependency** (`sharp` or hand-rolled tile-shuffle reverser).
3. **Coverage is redundant** for the user's stated `all_external` cases (Dandadan, JJK, Spy×Family, Chainsaw Man, OPM all present on both). The hedge value does not justify the cost.
4. **Maintenance flakiness compounds.** Two anti-bot stacks (CF + VRF rotation) mean breakage on either side becomes a release-blocker. shafat-96's cookie went stale in <12 months — that is the failure mode we would inherit.

**Form C (new ADR for Playwright VRF) is rejected, not deferred.** It would reintroduce the ~100 MB Chromium dependency [ADR-002](../adr/002-manual-cookie-paste.md) removed; the `f4rh4d-4hmed/MangaFire-API` reference is ~250 lines of stateful two-pass browser routing with retries because of an in-page anti-bot redirect. Far from "just run Playwright."

### Next-step actions

1. **Close issue #78** with a link to this document. Justification: VRF wall + ADR-002 conflict.
2. **Continue tracking partner sources in [#53](https://github.com/malaquiasdev/scanldr/issues/53)** — the redundancy hedge belongs there, with sources that don't require browser automation. Candidates worth probing on the same Phase-1 protocol: `weebcentral.com`, `mangapark.io`, `bato.to`, `comick.io` (the latter has an open API).
3. **Document the VRF finding in the ADR record.** Add a one-liner to [ADR-002](../adr/002-manual-cookie-paste.md) under "Consequences > Negative" noting that sites using runtime-computed tokens (VRF, signed URLs) are explicitly out-of-scope for the cookie-paste path.
4. **No Phase 2 dispatch.**
