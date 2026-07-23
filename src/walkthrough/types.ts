import type { BrowserLauncherDeps } from "@integrations/mangakakalot/auth/browser-capture/index.ts";
import type { DownloadBundleInput, DownloadBundleResult } from "../downloader/types.ts";
import type { PackVolumeInput, PackVolumeReplacingSourcesResult } from "../pack/types.ts";
import type { Config } from "../plugins/config/index.ts";
import type { Db } from "../plugins/db/index.ts";
import type { Logger } from "../plugins/logger/index.ts";
import type { SourceAdapter } from "../sources/adapters/index.ts";
import type { SourceDescriptor } from "../sources/types.ts";

/** Minimal surface of the downloader that executeWalkthrough needs. */
export interface Downloader {
  downloadBundle(input: DownloadBundleInput): Promise<DownloadBundleResult>;
}

/** Minimal surface of the packer that executeWalkthrough needs. */
export interface Packer {
  /**
   * Pack the volume, then best-effort-delete its per-chapter source files.
   * Deletion only ever happens after a successful write — structurally, there
   * is no way to reach it otherwise.
   */
  packVolumeReplacingSources(input: PackVolumeInput): Promise<PackVolumeReplacingSourcesResult>;
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

export interface BrowserCaptureDeps {
  /** Minimal launcher seam (patchright in production, mocked in tests). */
  launcherDeps: BrowserLauncherDeps;
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
  groupIntoVolume: boolean;
  /**
   * User-supplied volume number/name for the packed cbz.
   * null = use the chapter-range-derived default.
   */
  volumeName: string | null;
  coverUrl: string | null;
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

/** Deps wired into executeWalkthrough: production implementations or test fakes. */
export interface ExecuteDeps {
  downloader: Downloader;
  packer: Packer;
}

export interface ExecuteWalkthroughInput {
  source: SourceDescriptor;
  hit: SearchHit;
  selectedBundles: BundleItem[];
  groupIntoVolume: boolean;
  /** Optional user-supplied volume number/name; null = auto-derive from chapter range. */
  volumeName?: string | null;
  coverUrl: string | null;
  outDir: string;
  adapter: SourceAdapter;
  logger: Logger;
  /**
   * Session refresh function threaded from the orchestrator.
   * Used to auto-refresh when fetchChapterInput hits a CF rejection.
   * When omitted, CF errors during execute are logged as bundle failures and skipped.
   */
  refreshFn?: RefreshSession;
  /** Optional stderr progress renderer; no-op handle when disabled/omitted. */
  progress?: ProgressHandle;
  /**
   * Whether the stderr progress bar is active (mirrors ProgressOptions.enabled).
   * Gates the per-page `walkthrough.fetch_page` log: when the bar owns stderr,
   * the per-page line is suppressed (bar is the feedback); when the bar is
   * disabled (non-TTY / no --progress) or in JSON mode, the per-page log is
   * the fallback feedback and stays on.
   * Defaults to false (per-page log kept) when omitted.
   */
  progressEnabled?: boolean;
}

export interface ExecuteWalkthroughResult {
  outputs: string[];
  failed: number;
}

/** Signature of the session-refresh closure threaded through withSessionRetry. */
export type RefreshSession = () => Promise<void>;

export interface RangePickerOptions {
  hit: SearchHit;
  adapter: SourceAdapter;
  /**
   * Preloaded chapter listing for the "same manga" fast path — when provided, it is
   * reused instead of calling adapter.listChapters again.
   */
  preloadedChapters?: ChapterListing[];
}

export interface RangePickerResult {
  bundles: BundleItem[];
  /** The raw listing actually used (fetched or preloaded) — cache this for later reuse. */
  chapters?: ChapterListing[];
}

export interface SearchResultsPickerOptions {
  query: string;
  sourceLabel: string;
  adapter: SourceAdapter;
}

export interface VolumeNamePromptOptions {
  logger: Logger;
}

export interface CoverPromptOptions {
  logger: Logger;
}

export type NextAction = "same-manga" | "new-manga" | "quit";

export interface AuthCheckOptions {
  requiresAuth: boolean;
  logger: Logger;
  /** Injected in tests to override the default XDG auth path. */
  dataHome?: string;
  /**
   * Factory that creates the probe client on demand (after auth.json is written).
   * When omitted, no network probe is performed (file-presence check only).
   * Injected in tests; production callers provide via runWalkthrough options.
   */
  probeClientFactory?: SessionProbeClientFactory;
  /**
   * Browser capture seam (patchright-based undetected browser, issue #208).
   * When present and the probe detects a stale session, offered as the primary
   * re-auth path (fetch fresh cf_clearance from the live browser); falls back
   * to manual cURL paste on any failure (browser not found, capture error, or
   * probe validation failure). Injected in tests; production callers provide
   * via runWalkthrough options.
   */
  browserCapture?: BrowserCaptureDeps;
  /** Override fetch used to validate an auto-extracted session. Tests only. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export type ProbeOutcome =
  | { kind: "ok" }
  | { kind: "stale" }
  | { kind: "network_error"; message: string }
  | { kind: "transient_error"; status: number };

export interface RefreshSessionOptions {
  authPath: string;
  probeClientFactory: SessionProbeClientFactory;
  logger: Logger;
  browserCapture?: BrowserCaptureDeps;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface RunWalkthroughOptions extends WalkthroughInput {
  logger: Logger;
  /** Output directory for downloads. Defaults to current working directory. */
  outDir?: string;
  /** User config — threaded into the adapter factory. */
  config?: Config;
  /**
   * Already-open DB instance — enables the search/chapter-list SQLite cache (#164).
   * When omitted, the adapter runs uncached (e.g. direct test calls).
   */
  db?: Db;
  /** Bypasses the cache for this run's search + chapter-list fetches; still refreshes it. */
  forceRefresh?: boolean;
  /** Override the XDG data home used to resolve the auth.json path (tests inject a tmp dir). */
  dataHome?: string;
  /** Override adapter factory (tests inject fakes). */
  adapterFactory?: (sourceId: string, opts: { logger: Logger; config?: Config }) => SourceAdapter;
  /** Override downloader deps (tests inject fakes). */
  executeDeps?: ExecuteDeps;
  /**
   * Override the session probe client factory (tests inject fakes).
   * Production default: real fallback-http client created lazily after auth.json is written.
   * Pass null to disable probing (file-presence check only).
   */
  probeClientFactory?: SessionProbeClientFactory | null;
  /**
   * Override the browser capture seams (tests inject fakes).
   * Production default: real patchright capture (issue #208).
   * Pass null to disable the capture option entirely.
   */
  browserCapture?: BrowserCaptureDeps | null;
  /**
   * Override the refresh function for tests.
   * When provided, this is used instead of the real refreshSession for retry logic.
   */
  refreshFn?: () => Promise<void>;
  /**
   * Enables the stderr progress bar. Resolved by the CLI entrypoint as
   * `(process.stderr.isTTY || --progress) && !jsonMode`.
   * Defaults to false — callers that don't opt in get the previous log-only behavior.
   */
  progressEnabled?: boolean;
  /**
   * Bar-write seam of the shared stderr controller (see @plugins/terminal).
   * Threaded into `createProgress` so the bar and logger stay coordinated.
   * Defaults to raw stderr passthrough when omitted (e.g. direct test calls).
   */
  barWrite?: (chunk: string) => void;
  /**
   * Explicit bar-teardown seam of the shared stderr controller (see
   * @plugins/terminal). Threaded into `createProgress` so `finish()` resets
   * controller bar-state explicitly instead of relying on byte-sniffing.
   */
  endBar?: () => void;
}

/** Returned when walkthrough errors out in a handled way (WalkthroughError). */
export interface WalkthroughFailed {
  ok: false;
  reason: string;
}

/**
 * In-memory cache of listings already fetched for the current manga (hit),
 * so the "same manga" post-download branch never re-hits the adapter.
 */
export interface ChapterListingCache {
  chapters: ChapterListing[] | null;
}

export interface NewMangaIterationResult {
  hit: SearchHit;
  cache: ChapterListingCache;
  lastResult: WalkthroughResult;
}

export interface DownloadFlowOptions {
  title: string;
  hit: SearchHit;
  cache: ChapterListingCache;
  adapter: SourceAdapter;
  source: SourceDescriptor;
  outDir: string;
  logger: Logger;
  doRefresh: () => Promise<void>;
  executeDeps?: ExecuteDeps;
  progressEnabled: boolean;
  barWrite?: (chunk: string) => void;
  endBar?: () => void;
}
