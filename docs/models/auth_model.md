# Model — Auth & Session

> **Historical record (pre-epic #116).** The `auth.json`/session concept below still applies, but
> the surrounding standalone-command flow was removed in the #116 redesign; kept for history. See
> [ADR-008](../adr/008-retire-mangadex-source.md) / [ADR-009](../adr/009-retire-volume-mode.md)
> for current state.

## AuthSession

Persisted to `$XDG_DATA_HOME/scanldr/auth.json` (falling back to `~/.local/share/scanldr/auth.json` when `$XDG_DATA_HOME` is unset). The file is created with permissions `0600` and the parent directory with `0700` — secrets must not leak across users.

| Field | Type | Description |
|---|---|---|
| `cookies` | `Record<string, string>` | All cookies captured from the browser session for the target host. Must include `cf_clearance`; may also include `__cf_bm`, site session cookies, etc. |
| `userAgent` | `string` | User-Agent string used when the cookies were generated |
| `savedAt` | `number` | Unix timestamp (ms) of when the session was saved |

```ts
interface AuthSession {
  cookies: Record<string, string>;
  userAgent: string;
  savedAt: number;
}
```

## Notes

- `cookies` and `userAgent` are tightly coupled — Cloudflare validates the cookie set against the UA used at issuance. Using a different UA will cause Cloudflare to reject the session.
- The HTTP client must replay **every** cookie in the map on each request, not just `cf_clearance`. Some Cloudflare configurations also validate `__cf_bm` (bot management) which expires faster than `cf_clearance` but can be re-issued automatically by the server when the UA matches.
- Session TTL is approximately 30 days, gated by `cf_clearance`. The CLI does not auto-expire but will throw `CloudflareError` on a rejected request, signaling the user to re-authenticate.
- The file is gitignored — it contains live session credentials. (`.gitignore` covers the legacy CWD location for safety on existing checkouts; new sessions land under `$XDG_DATA_HOME` outside the repo.)
