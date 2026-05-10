import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseCurl } from "../../integrations/mangakakalot/auth/curl-parser.ts";
import type { AuthSession } from "../../integrations/mangakakalot/auth/types.ts";
import { resolveAuthPath } from "../../plugins/auth-path/index.ts";
import type { Logger } from "../../plugins/logger/index.ts";
import { editor } from "../prompts.ts";
import type { AuthResult } from "../types.ts";
import { WalkthroughError } from "../types.ts";

export interface AuthCheckOptions {
  requiresAuth: boolean;
  logger: Logger;
  /** Injected in tests to override the default XDG auth path. */
  dataHome?: string;
}

const MAX_PASTE_RETRIES = 2;

function isValidAuthFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

/** Write session atomically (write .tmp → rename). On rename failure, cleans up .tmp. */
async function persistSession(session: AuthSession, authPath: string): Promise<void> {
  await mkdir(dirname(authPath), { recursive: true, mode: 0o700 });
  const tmpPath = `${authPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(session, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    await rename(tmpPath, authPath);
  } catch (renameErr) {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmpPath);
    } catch {
      // best-effort cleanup — ignore unlink errors
    }
    throw renameErr;
  }
}

/** Step 3: check auth state. Prompt for cURL paste when needed and persist via auth service. */
export async function checkAuth(opts: AuthCheckOptions): Promise<AuthResult> {
  if (!opts.requiresAuth) {
    return { ok: true, skipped: true };
  }

  const authPath = resolveAuthPath({ dataHome: opts.dataHome });

  if (isValidAuthFile(authPath)) {
    return { ok: true, skipped: false };
  }

  // No valid session — prompt for cURL paste
  for (let attempt = 0; attempt < MAX_PASTE_RETRIES; attempt++) {
    const paste = await editor({
      message: "No valid session found. Paste a cURL command with cookie headers (opens editor):",
    });

    let parsed: ReturnType<typeof parseCurl> | null = null;
    try {
      parsed = parseCurl(paste);
    } catch {
      // parseCurl throws AuthError on bad input — treat as invalid
    }

    if (parsed !== null && Object.keys(parsed.cookies).length > 0) {
      const session: AuthSession = {
        cookies: parsed.cookies,
        userAgent: parsed.userAgent ?? "",
        savedAt: Date.now(),
      };
      await persistSession(session, authPath);
      opts.logger.info(
        { event: "walkthrough.auth_persisted", context: "walkthrough", path: authPath },
        "auth session saved",
      );
      return { ok: true, skipped: false, justAuthenticated: true };
    }

    const remaining = MAX_PASTE_RETRIES - attempt - 1;
    if (remaining > 0) {
      opts.logger.warn(
        {
          event: "walkthrough.auth_paste_invalid",
          context: "walkthrough",
          attempt: attempt + 1,
          remaining,
        },
        `Invalid cURL paste (must start with "curl " and contain cookies). ${remaining} attempt(s) left.`,
      );
    }
  }

  throw new WalkthroughError(
    `Could not parse cURL paste after ${MAX_PASTE_RETRIES} attempts. Run the walkthrough again.`,
  );
}
