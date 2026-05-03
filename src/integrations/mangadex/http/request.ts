import type { QueryParams } from "./types.ts";
import { jitter } from "./util.ts";

const BACKOFF_CAP_MS = 60_000;

export function buildUrl(base: string, path: string, query?: QueryParams): string {
  const url = new URL(path, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
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
