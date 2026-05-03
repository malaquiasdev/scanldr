import type { QueryParams } from "./types.ts";
import { jitter } from "./util.ts";

const BACKOFF_CAP_MS = 60_000;

export function buildUrl(base: string, path: string, query?: QueryParams): string {
  const url = new URL(path, base);
  if (!query) return url.toString();

  // Build scalar params via URLSearchParams (handles encoding).
  // Array params must be appended as raw query string to avoid [] being percent-encoded
  // (URLSearchParams encodes [] as %5B%5D but MangaDex requires literal brackets).
  const arrays: [string, string[]][] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      arrays.push([key, value.map(String)]);
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  if (arrays.length === 0) return url.toString();

  const base64 = url.toString();
  const sep = base64.includes("?") ? "&" : "?";
  const arrayStr = arrays
    .flatMap(([k, vs]) => vs.map((v) => `${k}=${encodeURIComponent(v)}`))
    .join("&");
  return `${base64}${sep}${arrayStr}`;
}

export function backoffMs(attempt: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** attempt + jitter(), BACKOFF_CAP_MS);
}

export function retryAfterMs(header: string | null, attempt: number, baseMs: number): number {
  if (header === null) return backoffMs(attempt, baseMs);
  const parsed = Number(header);
  return parsed > 1_000_000_000
    ? Math.max(0, parsed * 1000 - Date.now()) + jitter()
    : parsed * 1000 + jitter();
}
