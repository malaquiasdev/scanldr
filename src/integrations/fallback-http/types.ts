// Types and error classes for the fallback HTTP client.
// Per ADR-001: replays all captured cookies + UA on every request.
// The walkthrough auth-check step handles capturing and refreshing the session.

import type { Logger } from "@plugins/logger/index.ts";

/** Matches the signature of globalThis.fetch and test doubles. */
export type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class MissingAuthError extends Error {
  override readonly name = "MissingAuthError";
  constructor(public readonly path: string) {
    super(
      `Auth session not found at ${path}. Run \`bun start\` to capture one through the interactive walkthrough.`,
    );
  }
}

export class CloudflareError extends Error {
  override readonly name = "CloudflareError";
  constructor(public readonly url: string) {
    super(
      `Cloudflare rejected the request to ${url}. The session has likely expired; the walkthrough will prompt for a fresh cURL paste.`,
    );
  }
}

export interface FallbackHttpOptions {
  /** Path to auth.json. If omitted, resolves via the same XDG logic used by the walkthrough auth-check step. */
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
  /**
   * GET request WITHOUT cookie replay. Use for cross-origin assets (e.g. image CDNs
   * hosted on a different domain than the site). User-Agent is still sent from the
   * auth session — the cookie is the only header that's suppressed.
   *
   * Chain serialization, throttle, retry, and CF short-circuit semantics are
   * identical to `get()`. The caller is responsible for passing any Referer
   * required by the target host.
   */
  getAnonymous(url: string, headers?: Record<string, string>): Promise<Response>;
}
