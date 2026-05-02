# Model — Auth & Session

## AuthConfig

Persisted to `.scanldr-auth.json` in the project root.

| Field | Type | Description |
|---|---|---|
| `cookies` | `Record<string, string>` | All cookies captured from the browser session for the target host. Must include `cf_clearance`; may also include `__cf_bm`, site session cookies, etc. |
| `userAgent` | `string` | User-Agent string used when the cookies were generated |
| `savedAt` | `number` | Unix timestamp (ms) of when the session was saved |

```ts
interface AuthConfig {
  cookies: Record<string, string>;
  userAgent: string;
  savedAt: number;
}
```

## Notes

- `cookies` and `userAgent` are tightly coupled — Cloudflare validates the cookie set against the UA used at issuance. Using a different UA will cause Cloudflare to reject the session.
- The HTTP client must replay **every** cookie in the map on each request, not just `cf_clearance`. Some Cloudflare configurations also validate `__cf_bm` (bot management) which expires faster than `cf_clearance` but can be re-issued automatically by the server when the UA matches.
- Session TTL is approximately 30 days, gated by `cf_clearance`. The CLI does not auto-expire but will throw `CloudflareError` on a rejected request, signaling the user to re-authenticate.
- The file is gitignored — it contains live session credentials.
