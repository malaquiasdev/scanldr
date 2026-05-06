// Cover image fetcher for pack-as-volume.
// Reuses auth.json cookies + UA when available; falls back to bare UA fetch
// if auth.json is missing or unreadable (mirrors FallbackHttpClient's pattern).

import { readFile } from "node:fs/promises";
import { resolveAuthPath } from "@plugins/auth-path/index.ts";
import type { CoverImage } from "./types.ts";

export type { CoverImage };

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const MAX_COVER_BYTES = 50 * 1024 * 1024; // 50 MB

const DEFAULT_UA =
  "Mozilla/5.0 (compatible; scanldr/1.0; +https://github.com/malaquiasdev/scanldr)";

/** Map of supported Content-Type → file extension. */
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export interface FetchCoverOptions {
  /** Override fetch (for testing). */
  fetch?: FetchFn;
  /** Override auth.json path (for testing). */
  authPath?: string;
}

interface AuthSession {
  cookies: Record<string, string>;
  userAgent: string;
  savedAt: number;
}

function isValidAuthSession(v: unknown): v is AuthSession {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    obj.cookies !== null &&
    typeof obj.cookies === "object" &&
    !Array.isArray(obj.cookies) &&
    typeof obj.userAgent === "string" &&
    typeof obj.savedAt === "number"
  );
}

async function loadAuthHeaders(authPath: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(authPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isValidAuthSession(parsed)) return { "user-agent": DEFAULT_UA };
    const cookieHeader =
      Object.keys(parsed.cookies).length > 0
        ? Object.entries(parsed.cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join("; ")
        : undefined;
    const headers: Record<string, string> = { "user-agent": parsed.userAgent };
    if (cookieHeader !== undefined) headers.cookie = cookieHeader;
    return headers;
  } catch {
    // auth.json missing or corrupt — fall back to bare UA, no failure
    return { "user-agent": DEFAULT_UA };
  }
}

/**
 * Fetch a cover image from a URL.
 *
 * Validates:
 *   - URL scheme must be http(s)
 *   - HTTP status must be 2xx
 *   - Content-Type must start with image/ and be one of the supported types
 *   - Body size must be <= MAX_COVER_BYTES
 *
 * Reuses auth.json cookies+UA when available.
 *
 * @throws Error with a user-friendly message on any validation failure.
 */
export async function fetchCover(url: string, opts: FetchCoverOptions = {}): Promise<CoverImage> {
  // Validate scheme
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Only http(s) URLs allowed`);
  }

  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const authPath = opts.authPath ?? resolveAuthPath();
  const headers = await loadAuthHeaders(authPath);

  let res: Response;
  try {
    res = await fetchFn(url, { headers });
  } catch (err) {
    throw new Error(
      `Cover fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Cover fetch failed: HTTP ${res.status}`);
  }

  const rawCt = res.headers.get("content-type") ?? "";
  const ct = rawCt.split(";")[0]?.trim() ?? "";

  if (!ct.startsWith("image/")) {
    throw new Error(`URL did not return an image (got ${ct || rawCt || "unknown"})`);
  }

  const ext = MIME_TO_EXT[ct];
  if (!ext) {
    throw new Error(`URL did not return an image (got ${ct})`);
  }

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_COVER_BYTES) {
    const mb = (bytes.byteLength / 1024 / 1024).toFixed(1);
    throw new Error(`Cover too large: ${mb}MB (max 50MB)`);
  }

  return { bytes: new Uint8Array(bytes), ext };
}
