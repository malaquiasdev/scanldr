import type { DownloadBundleInput, DownloadBundleResult } from "../modules/downloader/types.ts";
import type { PackVolumeInput, PackVolumeResult } from "../pack/types.ts";
import type { SourceDescriptor } from "../sources/types.ts";

/** Minimal surface of the downloader that executeWalkthrough needs. */
export interface Downloader {
  downloadBundle(input: DownloadBundleInput): Promise<DownloadBundleResult>;
}

/** Minimal surface of the packer that executeWalkthrough needs. */
export interface Packer {
  packVolume(input: PackVolumeInput): Promise<PackVolumeResult>;
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

/** DTO returned by adapter.listVolumes() */
export interface VolumeListing {
  /** Volume number as a string, e.g. "1", "3.5" */
  volume: string;
  /** Human-readable label, e.g. "Volume 3 (Ch. 20–30)" */
  label: string;
  /** Ordered list of constituent chapter ids (to pass to fetchChapterInput) */
  chapterIds: string[];
  /** Matching chapter numbers (parallel array, same length as chapterIds) */
  chapterNums: string[];
}

export type ModeSelection = "chapter" | "volume";

export interface BundleItem {
  kind: "chapter" | "volume";
  /** Display label shown to user e.g. "Chapter 1" or "Volume 3" */
  label: string;
  /** For chapter mode: the chapter id. For volume mode: synthetic display key (e.g. "vol:1") */
  id: string;
  /** Chapter number (chapter mode) OR volume number (volume mode) */
  num: string;
  /** Volume mode only: ordered constituent chapter ids */
  chapterIds?: string[];
  /** Volume mode only: matching chapter numbers (parallel to chapterIds) */
  chapterNums?: string[];
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
  mode: ModeSelection;
  selectedBundles: BundleItem[];
  groupIntoVolume: boolean;
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
