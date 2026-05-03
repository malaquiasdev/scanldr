import type { FetchFn, MangaDexHttpClient } from "@integrations/mangadex/http/index.ts";
import type { Logger } from "@plugins/logger/index.ts";

export type ImageQuality = "data" | "data-saver";

export interface AtHomeServer {
  baseUrl: string;
  hash: string;
  pages: string[];
}

/** Shape returned by MangaDex /at-home/server/:chapterId */
export interface AtHomeServerResponse {
  baseUrl: string;
  chapter: {
    hash: string;
    data: string[];
    dataSaver: string[];
  };
}

/** POST body sent to https://api.mangadex.network/report */
export interface ReportPayload {
  url: string;
  success: boolean;
  bytes: number;
  duration: number;
  cached: boolean;
}

export interface AtHomeOptions {
  httpClient: MangaDexHttpClient;
  logger: Logger;
  quality?: ImageQuality;
  /** Override fetch for testing */
  fetch?: FetchFn;
  /** Override sleep for testing */
  sleep?: (ms: number) => Promise<void>;
}
