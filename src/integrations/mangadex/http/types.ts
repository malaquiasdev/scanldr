import type { Config } from "@plugins/config/index.ts";
import type { Logger } from "@plugins/logger/index.ts";

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

export type QueryParams = Record<string, string | string[] | number | boolean | undefined>;
