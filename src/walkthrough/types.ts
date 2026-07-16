import type { DownloadBundleInput, DownloadBundleResult } from "../downloader/types.ts";
import type { SourceDescriptor } from "../sources/types.ts";

/** Minimal surface of the downloader that executeWalkthrough needs. */
export interface Downloader {
  downloadBundle(input: DownloadBundleInput): Promise<DownloadBundleResult>;
}

/** @deprecated Empty — kept for backwards compat; will be removed in next major. */
// biome-ignore lint/suspicious/noEmptyInterface: intentionally kept for API compatibility
export interface WalkthroughInput {}

/** One result from a source search. Mirrors MangaCandidate from shared types. */
export interface SearchHit {
  id: string;
  title: string;
  originalLanguage: string;
  year: number | null;
}

/** DTO returned by adapter.listChapters() */
export interface ChapterListing {
  /** Opaque id passed back to the adapter to fetch pages (e.g. composite "slug/chapter-slug") */
  id: string;
  /** Human chapter number, e.g. "1", "103.5" */
  num: string;
  /** Human-readable label, e.g. "Chapter 1 — My First Adventure" */
  label: string;
}

export interface BundleItem {
  /** Display label shown to user e.g. "Chapter 1" */
  label: string;
  /** The chapter id. */
  id: string;
  /** Chapter number */
  num: string;
}

export interface AuthResult {
  ok: boolean;
  /** true = source doesn't require auth OR session already valid */
  skipped: boolean;
  /** true when the user just successfully pasted a new cURL */
  justAuthenticated?: boolean;
  /** true when the session was stale and auto-refreshed via cURL re-paste */
  refreshed?: boolean;
}

/**
 * Minimal probe surface injected into auth-check.
 * Keeps the walkthrough layer decoupled from the full fallback-http surface.
 */
export interface SessionProbeClient {
  /**
   * GET the target URL with authenticated headers.
   * Resolves with a Response on success, throws on network error or CF rejection.
   */
  get(url: string, headers?: Record<string, string>): Promise<Response>;
}

/**
 * Factory that creates a SessionProbeClient on demand.
 * Called lazily by auth-check so auth.json exists when the client is constructed.
 */
export type SessionProbeClientFactory = () => Promise<SessionProbeClient>;

export interface WalkthroughResult {
  title: string;
  source: SourceDescriptor;
  hit: SearchHit;
  selectedBundles: BundleItem[];
}

/** Sentinel returned when the user cancels the walkthrough (Ctrl+C). */
export interface WalkthroughCancelled {
  cancelled: true;
}

/**
 * Domain error for walkthrough-level failures.
 * Allowed exception to the no-classes rule per docs/conventions.md:
 * "Error subclasses are allowed when a domain needs a typed exception that callers branch on with instanceof".
 */
export class WalkthroughError extends Error {
  override readonly name = "WalkthroughError";
}

export interface ProgressOptions {
  /** Gate: (isTTY || --progress) && !jsonMode. When false every method is a no-op. */
  enabled: boolean;
  totalChapters: number;
  /** Injectable sink for tests; defaults to process.stderr.write. */
  write?: (chunk: string) => void;
  /**
   * Explicit bar-teardown seam from the shared stderr controller (see
   * @plugins/terminal). Invoked by `finish()` so controller bar-state is
   * reset via an explicit call rather than inferred by sniffing bytes.
   * Optional so direct/test construction of `createProgress` still works.
   */
  endBar?: () => void;
  /** Injectable clock for tests; defaults to Date.now. */
  now?: () => number;
}

export interface ProgressState {
  currentChapter: number;
  totalChapters: number;
  currentPage: number;
  totalPages: number;
  percent: number;
  avgPageMs: number;
  etaMs: number;
  /** Bundle display label (e.g. "Chapter 33"); empty before first updateChapter. */
  label: string;
}

export interface ProgressHandle {
  /** Call when starting a new chapter/bundle; resets page counter. */
  updateChapter(chapterIndex: number, chapterTotalPages: number, label: string): void;
  /** Call after each page completes. Counts completions internally; order-agnostic. */
  updatePage(): void;
  /** Clears the line with a trailing newline. No-op when disabled. */
  finish(): void;
}
