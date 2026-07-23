import { readFile } from "node:fs/promises";
import { resolveAuthPath } from "@plugins/auth-path/index.ts";
import { isValidAuthSession, toCookieHeader } from "@plugins/auth-session/index.ts";
import type { CoverImage, FetchCoverOptions } from "./types.ts";

export type { CoverImage };

export const MAX_COVER_BYTES = 50 * 1024 * 1024;

const DEFAULT_UA =
  "Mozilla/5.0 (compatible; scanldr/1.0; +https://github.com/malaquiasdev/scanldr)";

/** Map of supported Content-Type → file extension. */
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/**
 * Load auth headers. If auth.json is missing or corrupt, falls back to bare UA,
 * no failure.
 */
async function loadAuthHeaders(authPath: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(authPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isValidAuthSession(parsed)) return { "user-agent": DEFAULT_UA };
    const cookieHeader =
      Object.keys(parsed.cookies).length > 0 ? toCookieHeader(parsed.cookies) : undefined;
    const headers: Record<string, string> = { "user-agent": parsed.userAgent };
    if (cookieHeader !== undefined) headers.cookie = cookieHeader;
    return headers;
  } catch {
    return { "user-agent": DEFAULT_UA };
  }
}

/**
 * Cover image fetcher for pack-as-volume; reuses auth.json cookies+UA, falls back
 * to bare UA (mirrors FallbackHttpClient).
 *
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
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs allowed");
  }

  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const authPath = opts.authPath ?? resolveAuthPath();
  const headers = await loadAuthHeaders(authPath);

  let res: Response;
  try {
    res = await fetchFn(url, { headers });
  } catch (err) {
    throw new Error(`Cover fetch failed: ${err instanceof Error ? err.message : String(err)}`);
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
