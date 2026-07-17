# Manual Auth — Capturing a Cloudflare Session

Capturing your real-browser Cloudflare session lets the downloader (mangakakalot.gg) bypass the bot protection. This happens either via the standalone `scanldr auth` command (historical, pre-epic #116) or inline during the interactive walkthrough (`bun start`), which prompts for a session when Mangakakalot is selected and no valid session exists.

## Browser auto-extract (macOS + Chrome/Opera/Brave/Edge) — issue #202 (UA fix: #205)

On macOS, when a supported Chromium browser (Chrome, Opera, Brave, or Edge) is installed, the walkthrough tries this lower-friction path first:

1. scanldr opens `https://www.mangakakalot.gg/` in your browser (`open -a <Browser>`).
2. Solve the Cloudflare challenge if one appears, then press Enter in the terminal.
3. macOS will prompt a Keychain dialog the first time (`<Browser> Safe Storage` wants to access your keychain). Click **"Always Allow"** — not "Allow". "Allow" only authorizes this one process invocation and macOS will ask again on the very next run; "Always Allow" remembers the decision so this step is skipped on future runs. This prompt only recurs when a genuine re-authentication happens (the persisted session went stale) — it does not appear on every run once a valid session is stored in `auth.json`.
4. scanldr locates your browser's cookie store and decrypts the domain-wide `cf_clearance` (macOS Keychain + the standard Chromium `v10` AES scheme — no new dependency, no automation).
5. **User-agent**: `cf_clearance` is bound to the exact User-Agent string the browser sent when it solved the challenge.
   - **Chrome**: scanldr derives the exact UA automatically — Chrome's own app version IS its Chromium engine version, so no prompt is needed.
   - **Opera / Brave / Edge**: these ship their own version numbers that don't map 1:1 to the underlying Chromium release, so scanldr cannot safely fabricate a UA (a wrong UA makes the probe fail every time — see #205). Instead, scanldr prompts you to paste your browser's exact User-Agent, one line, no editor needed. Get it from either:
     - the browser's DevTools console: type `navigator.userAgent` and press Enter, or
     - `opera://about` (Opera) / `about:version` (Brave, Edge) — look for the "User Agent" field.
6. The extracted session (cookie + UA) is validated with a real request **before** anything is persisted. If validation fails for any reason (no `cf_clearance` found, Keychain access denied, blank/wrong pasted UA), scanldr automatically falls back to the manual cURL paste below — you'll never end up with a silently broken session.

This only reads cookies from your own browser, on your own machine; the raw token is never logged (same redaction as the manual flow). Multiple browser profiles are handled automatically — the profile with the most recently solved challenge wins.

Firefox, Safari, and non-macOS platforms don't have this path yet (see ADR-002 addendum) — the manual paste flow below is the fallback/only option there.

## Quick version (walkthrough prompt, manual paste fallback)

1. Open the target manga page in your browser.
2. Open DevTools (F12) and go to the **Network** tab.
3. Reload the page.
4. Right-click any request to `mangakakalot.gg` and choose **Copy as cURL**.
5. Paste the copied command into the walkthrough prompt.

The `cf_clearance` cookie extracted from the cURL is persisted to `~/.local/share/scanldr/auth.json` for the session.

## Detailed version (`scanldr auth` command)

> **Historical.** The standalone `scanldr auth` command is a pre-epic #116 path. The current
> walkthrough (`bun start`) Quick-version prompt above is the primary way to authenticate.

## Why manual?

Playwright-based automation is detected by Cloudflare and the challenge never resolves (see ADR-002). Copying the request from your real browser is the only reliable approach.

## Step-by-step

1. Open **https://www.mangakakalot.gg/search/story/dragon-ball** in your real browser (Chrome, Firefox, or Safari).

2. Solve any Cloudflare challenge that appears. Wait until the page fully loads.

3. Open DevTools:
   - Chrome / Edge: `F12` or `Cmd+Option+I`
   - Firefox: `F12`
   - Safari: `Cmd+Option+I` (enable DevTools in Safari Preferences first)

4. Go to the **Network** tab (if you see "Paused in debugger", see [Troubleshooting](#troubleshooting) below). Reload the page (`F5` / `Cmd+R`).

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

### "Paused in debugger" banner appears when opening DevTools

**Symptom:** As soon as DevTools opens (or on page reload with DevTools open), the browser freezes with a "Paused in debugger" banner at the top. The Network tab is unusable.

**Cause:** mangakakalot.gg injects a `debugger;` statement inside a loop as an anti-inspection measure. Every modern browser honoured the statement when DevTools is attached, freezing execution.

**Fix:**

1. Open DevTools → **Sources** tab.
2. Click the "Deactivate breakpoints" icon at the top of the right panel (shortcut `Cmd+F8` on Mac, `Ctrl+F8` on Linux/Windows).
3. Click ▶ "Resume script execution" to leave the current pause.
4. Reload the page (`Cmd+R` / `Ctrl+R`) — `debugger;` calls are now ignored.
5. Continue with the normal **Network** tab → **Copy as cURL** flow.

![Deactivate breakpoints button](./images/devtools-deactivate-breakpoints.png) <!-- TODO: capture -->

### Common errors

| Error | Fix |
|---|---|
| `Interactive paste in your terminal is unreliable` | Pipe the cURL instead of pasting interactively — see step 6 above. |
| `missing cf_clearance` | You copied the wrong request or the challenge wasn't solved. Make sure to wait for the page to fully load before copying. |
| `missing user-agent` | Your browser stripped the User-Agent header from the copy. Try Chrome with "Copy as cURL (bash)". |
| `session verification failed: Cloudflare still rejecting` | The cURL is stale (tab was open too long). Reload the page, wait for full load, re-copy. |

## Session lifetime

`cf_clearance` is valid for approximately **30 days**. Re-run `scanldr auth` when downloads start failing with `CloudflareError`.
