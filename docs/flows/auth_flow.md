# Flow — Authentication (Cloudflare Bypass)

The auth flow is the only place where Playwright is used. It opens a real browser so the user can solve the Cloudflare Turnstile challenge. After the challenge passes, the CLI automatically extracts the `cf_clearance` cookie — no manual copy/paste.

The saved session is valid for approximately 30 days. When it expires, re-running `scanldr auth` is all that's needed.

## Sequence Diagram

```mermaid
sequenceDiagram
    actor User
    participant CLI as scanldr CLI
    participant Browser as Playwright (Chromium headful)
    participant CF as Cloudflare / mangakakalot.gg
    participant FS as $XDG_DATA_HOME/scanldr/auth.json

    User->>CLI: scanldr auth
    CLI->>Browser: launch headful Chromium
    Browser->>CF: navigate to mangakakalot.gg
    CF-->>Browser: Turnstile challenge page

    Note over User,Browser: User solves the challenge manually in the browser window

    User->>Browser: clicks / waits for challenge to pass
    Browser->>CF: challenge response
    CF-->>Browser: sets cf_clearance cookie + redirects to site

    Browser-->>CLI: page settled (networkidle)
    CLI->>Browser: extract cf_clearance from cookie store
    CLI->>Browser: extract User-Agent from browser context
    Browser-->>CLI: { cf_clearance, userAgent }

    CLI->>CF: GET mangakakalot.gg (verify session)
    CF-->>CLI: 200 OK (no challenge)

    CLI->>FS: write { cf_clearance, userAgent, savedAt }
    CLI-->>User: "Auth saved. Valid for ~30 days."
    CLI->>Browser: close
```

## Error Cases

| Situation | Behavior |
|---|---|
| User closes the browser before challenge resolves | CLI exits with error — no auth saved |
| Site returns 403 after cookie replay | `CloudflareError` thrown — user must re-run `scanldr auth` |
| `$XDG_DATA_HOME/scanldr/auth.json` missing | Any download command exits early with "Not authenticated. Run `scanldr auth` first." |
| Cookie expired (>30 days) | Same as above — `CloudflareError` triggers re-auth prompt |
