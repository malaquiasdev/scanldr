// Types and error classes for the fallback HTTP client.
// Per ADR-001: replays all captured cookies + UA on every request.

import type { Logger } from "@plugins/logger/index.ts";

/** Matches the signature of globalThis.fetch and test doubles. */
export type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class MissingAuthError extends Error {
  override readonly name = "MissingAuthError";
  constructor(public readonly path: string) {
    super(`Auth session not found at ${path}. Run \`scanldr auth\` to capture one.`);
  }
}

export class CloudflareError extends Error {
  override readonly name = "CloudflareError";
  constructor(public readonly url: string) {
    super(
      `Cloudflare rejected the request to ${url}. Run \`scanldr auth\` to refresh the session.`,
    );
  }
}

export interface FallbackHttpOptions {
  /** Path to auth.json. If omitted, resolves via the same XDG logic used by `scanldr auth`. */
  authPath?: string;
  logger: Logger;
  /** Override fetch for testing. Defaults to globalThis.fetch. */
  fetch?: FetchFn;
  /** Override sleep for testing. Defaults to setTimeout-based. */
  sleep?: (ms: number) => Promise<void>;
  /** Override the clock for testing. Defaults to Date.now. */
  now?: () => number;
}

export interface FallbackHttpClient {
  /**
   * GET request with cookie replay + UA from the auth session.
   *
   * @param url Target URL.
   * @param headers Optional extra headers (e.g. `referer` for CDN-specific endpoints).
   *   Keys are lowercased before merge. `cookie` and `user-agent` are always
   *   re-enforced from the auth session and cannot be overridden by the caller.
   */
  get(url: string, headers?: Record<string, string>): Promise<Response>;
}
