import type { QueryParams } from "./types.ts";
import { jitter } from "./util.ts";

const BACKOFF_CAP_MS = 60_000;

export function buildUrl(base: string, path: string, query?: QueryParams): string {
  const url = new URL(path, base);
  if (!query) return url.toString();

  // Keys containing "[" must be appended as raw query string — URLSearchParams encodes
  // brackets as %5B%5D but MangaDex requires literal brackets (includes[], order[chapter], …).
  const raw: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) raw.push(`${key}=${encodeURIComponent(v)}`);
    } else if (key.includes("[")) {
      raw.push(`${key}=${encodeURIComponent(String(value))}`);
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  if (raw.length === 0) return url.toString();

  const built = url.toString();
  const sep = built.includes("?") ? "&" : "?";
  return `${built}${sep}${raw.join("&")}`;
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
