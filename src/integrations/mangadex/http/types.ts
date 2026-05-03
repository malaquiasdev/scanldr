import type { Config } from "@plugins/config/index.ts";
import type { Logger } from "@plugins/logger/index.ts";

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface MangaDexHttpOptions {
  baseUrl?: string;
  logger: Logger;
  config: Config;
  /** Override sleep function for tests */
  sleep?: (ms: number) => Promise<void>;
  /** Override fetch for tests */
  fetch?: FetchFn;
}

export interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export type QueryParams = Record<string, string | string[] | number | boolean | undefined>;
