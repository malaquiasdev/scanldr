import { existsSync, readFileSync } from "node:fs";
import { resolveAuthPath } from "../../plugins/auth-path/index.ts";
import { editor } from "../prompts.ts";
import type { AuthResult } from "../types.ts";

export interface AuthCheckOptions {
  requiresAuth: boolean;
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

function isValidCurlPaste(paste: string): boolean {
  const lower = paste.toLowerCase();
  return lower.trimStart().startsWith("curl ") && lower.includes("cookie:");
}

/** Step 3: check auth state. Prompt for cURL paste when needed. */
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

    if (isValidCurlPaste(paste)) {
      // PHASE 3: persist auth via existing auth module
      return { ok: true, skipped: false };
    }

    const remaining = MAX_PASTE_RETRIES - attempt - 1;
    if (remaining > 0) {
      process.stderr.write(
        `Invalid cURL paste (must start with "curl " and contain "cookie:" header). ${remaining} attempt(s) left.\n`,
      );
    }
  }

  throw new Error(
    'Auth failed: pasted cURL command must start with "curl " and contain a "cookie:" header.',
  );
}
