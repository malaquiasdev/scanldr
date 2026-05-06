# Manual Auth — Capturing a Cloudflare Session

`scanldr auth` captures your real-browser Cloudflare session so that the fallback downloader (mangakakalot.gg) can bypass the bot protection.

## Why manual?

Playwright-based automation is detected by Cloudflare and the challenge never resolves (see ADR-002). Copying the request from your real browser is the only reliable approach.

## Step-by-step

1. Open **https://www.mangakakalot.gg/search/story/dragon-ball** in your real browser (Chrome, Firefox, or Safari).

2. Solve any Cloudflare challenge that appears. Wait until the page fully loads.

3. Open DevTools:
   - Chrome / Edge: `F12` or `Cmd+Option+I`
   - Firefox: `F12`
   - Safari: `Cmd+Option+I` (enable DevTools in Safari Preferences first)

4. Go to the **Network** tab. Reload the page (`F5` / `Cmd+R`).

5. In the Network panel, find the request to `/search/story/dragon-ball`. Right-click it:
   - Chrome/Edge: **Copy → Copy as cURL (bash)**
   - Firefox: **Copy → Copy as cURL**
   - Safari: **Copy → Copy as cURL**

   ![DevTools Copy as cURL](./images/devtools-copy-curl.png) <!-- TODO: capture -->

6. With the cURL on your clipboard, run:

   ```bash
   pbpaste | scanldr auth          # macOS
   xclip -o -selection clipboard | scanldr auth   # Linux X11
   wl-paste | scanldr auth         # Linux Wayland
   ```

   `scanldr auth` will:
   - Parse the cookies and User-Agent from the cURL
   - Verify the session with a live request to the site
   - Save `auth.json` to your XDG data directory (e.g. `~/.local/share/scanldr/auth.json`)

## Fallback: pipe from a file

If you saved the cURL to a file instead:

```bash
scanldr auth < curl.txt
```

> **Note:** Interactive paste (typing or pasting directly into the terminal while `scanldr auth` waits) is intentionally rejected. Multi-line cURL output is silently truncated by macOS Terminal and iTerm2 when pasted into stdin, which leads to confusing parse errors. Piping is the only reliable approach.

## Troubleshooting

| Error | Fix |
|---|---|
| `Interactive paste in your terminal is unreliable` | Pipe the cURL instead of pasting interactively — see step 6 above. |
| `missing cf_clearance` | You copied the wrong request or the challenge wasn't solved. Make sure to wait for the page to fully load before copying. |
| `missing user-agent` | Your browser stripped the User-Agent header from the copy. Try Chrome with "Copy as cURL (bash)". |
| `session verification failed: Cloudflare still rejecting` | The cURL is stale (tab was open too long). Reload the page, wait for full load, re-copy. |

## Session lifetime

`cf_clearance` is valid for approximately **30 days**. Re-run `scanldr auth` when downloads start failing with `CloudflareError`.
