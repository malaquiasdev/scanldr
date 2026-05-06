// Manual cURL paste auth service.
// Reads a cURL paste from stdin, validates, verifies, and writes auth.json.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveAuthPath } from "@plugins/auth-path/index.ts";
import { parseCurl } from "./curl-parser.ts";
import { AuthError } from "./types.ts";
import type { AuthSession, RunAuthOptions } from "./types.ts";

const VERIFY_URL = "https://www.mangakakalot.gg/search/story/dragon-ball";
const CF_CHALLENGE_MARKERS = ["Just a moment...", "Enable JavaScript and cookies"];

const INSTRUCTIONS = `
To capture a session for the fallback site:

  1. Open ${VERIFY_URL} in your real browser
  2. Solve any Cloudflare challenge that appears
  3. Open DevTools (F12) → Network tab → reload the page
  4. Right-click the request to /search/... → Copy → Copy as cURL
  5. Paste below, then press Enter on an empty line to submit:

`;

/**
 * Reads from stdin until two consecutive newlines (empty line) or EOF.
 * Returns the trimmed paste.
 */
async function readStdinUntilEmpty(): Promise<string> {
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    process.stdin.resume();
    process.stdin.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const so_far = Buffer.concat(chunks).toString("utf8");
      // Stop when we see two consecutive newlines (blank line submitted)
      if (/\n\s*\n/.test(so_far)) {
        process.stdin.pause();
        resolve(so_far.trim());
      }
    });
    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8").trim());
    });
    process.stdin.on("error", reject);
  });
}

function isChallengeBody(body: string): boolean {
  return CF_CHALLENGE_MARKERS.some((m) => body.includes(m));
}

export async function runAuth(opts: RunAuthOptions): Promise<void> {
  const { logger } = opts;
  const outPath = resolveAuthPath(opts);
  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const readStdin = opts.readStdin ?? readStdinUntilEmpty;

  process.stdout.write(INSTRUCTIONS);
  process.stdout.write("> ");

  const raw = await readStdin();

  if (!raw) {
    throw new AuthError("empty input — paste the cURL command copied from DevTools");
  }

  const parsed = parseCurl(raw);

  if (!parsed.cookies.cf_clearance) {
    throw new AuthError(
      "missing cf_clearance — did you copy from the right request? Make sure Cloudflare challenge is solved first.",
    );
  }

  if (!parsed.userAgent) {
    throw new AuthError("missing user-agent — re-copy the request, headers may have been stripped");
  }

  const cookieNames = Object.keys(parsed.cookies).join(", ");
  process.stdout.write(`\n✓ Parsed cookies (${cookieNames})\n`);
  process.stdout.write(`✓ User-Agent: ${parsed.userAgent}\n`);

  logger.info(
    {
      event: "auth.parsed",
      context: "auth",
      cookieCount: Object.keys(parsed.cookies).length,
    },
    "parsed cURL",
  );

  // Verify the session
  const cookieHeader = Object.entries(parsed.cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

  let verifyRes: Response;
  try {
    verifyRes = await fetchFn(VERIFY_URL, {
      headers: {
        cookie: cookieHeader,
        "user-agent": parsed.userAgent,
      },
    });
  } catch (err) {
    throw new AuthError(
      `session verification failed: network error — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (verifyRes.status === 403) {
    throw new AuthError(
      "session verification failed: Cloudflare still rejecting — paste may be stale",
    );
  }

  const body = await verifyRes.text();
  if (isChallengeBody(body)) {
    throw new AuthError(
      "session verification failed: Cloudflare still rejecting — paste may be stale",
    );
  }

  process.stdout.write(`✓ Verified session against ${VERIFY_URL}\n`);

  logger.info({ event: "auth.verified", context: "auth", url: VERIFY_URL }, "session verified");

  const session: AuthSession = {
    cookies: parsed.cookies,
    userAgent: parsed.userAgent,
    savedAt: Date.now(),
  };

  await mkdir(dirname(outPath), { recursive: true, mode: 0o700 });
  await writeFile(outPath, JSON.stringify(session, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });

  process.stdout.write(`✓ Saved to ${outPath} (mode 0600)\n`);

  logger.info({ event: "auth.saved", context: "auth", path: outPath }, `auth saved to ${outPath}`);
}
