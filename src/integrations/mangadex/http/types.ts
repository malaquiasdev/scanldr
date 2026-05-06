import type { Config } from "@plugins/config/index.ts";
import type { Logger } from "@plugins/logger/index.ts";

export class MangaDexHttpError extends Error {
  override readonly name = "MangaDexHttpError";
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
  }
}

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface MangaDexHttpOptions {
  baseUrl?: string;
  logger: Logger;
  config: Config;
  sleep?: (ms: number) => Promise<void>;
  fetch?: FetchFn;
}

export interface MangaDexHttpClient {
  get: <T>(path: string, query?: QueryParams) => Promise<T>;
}

export interface BucketState {
  tokens: number;
  lastRefill: number;
}

export type QueryParams = Record<string, string | string[] | number | boolean | undefined>;
