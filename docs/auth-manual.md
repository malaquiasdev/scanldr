# Manual Auth — Capturing a Cloudflare Session

`scanldr auth` captures your real-browser Cloudflare session so that the fallback downloader (mangakakalot.gg) can bypass the bot protection.

## Why manual?

Playwright-based automation is detected by Cloudflare and the challenge never resolves (see ADR-002). Copying the request from your real browser is the only reliable approach.

## Step-by-step

1. Run `scanldr auth` in your terminal. It will print instructions and wait for input.

2. Open **https://www.mangakakalot.gg/search/story/dragon-ball** in your real browser (Chrome, Firefox, or Safari).

3. Solve any Cloudflare challenge that appears. Wait until the page fully loads.

4. Open DevTools:
   - Chrome / Edge: `F12` or `Cmd+Option+I`
   - Firefox: `F12`
   - Safari: `Cmd+Option+I` (enable DevTools in Safari Preferences first)

5. Go to the **Network** tab. Reload the page (`F5` / `Cmd+R`).

6. In the Network panel, find the request to `/search/story/dragon-ball`. Right-click it:
   - Chrome/Edge: **Copy → Copy as cURL (bash)**
   - Firefox: **Copy → Copy as cURL**
   - Safari: **Copy → Copy as cURL**

   ![DevTools Copy as cURL](./images/devtools-copy-curl.png) <!-- TODO: capture -->

7. Paste the copied cURL into the terminal where `scanldr auth` is waiting. Press **Enter** on an empty line to submit.

8. `scanldr auth` will:
   - Parse the cookies and User-Agent from the cURL
   - Verify the session with a live request to the site
   - Save `auth.json` to your XDG data directory (e.g. `~/.local/share/scanldr/auth.json`)

## Troubleshooting

| Error | Fix |
|---|---|
| `missing cf_clearance` | You copied the wrong request or the challenge wasn't solved. Make sure to wait for the page to fully load before copying. |
| `missing user-agent` | Your browser stripped the User-Agent header from the copy. Try Chrome with "Copy as cURL (bash)". |
| `session verification failed: Cloudflare still rejecting` | The cURL is stale (tab was open too long). Reload the page, wait for full load, re-copy. |

## Session lifetime

`cf_clearance` is valid for approximately **30 days**. Re-run `scanldr auth` when downloads start failing with `CloudflareError`.
