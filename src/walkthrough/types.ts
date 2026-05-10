import type { SourceDescriptor } from "../sources/types.ts";

export interface WalkthroughInput {
  titlePrefill?: string;
}

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
  /** Human-readable label, e.g. "Chapter 1 — My First Adventure" */
  label: string;
}

/** DTO returned by adapter.listVolumes() */
export interface VolumeListing {
  /** Opaque id for the volume (used as BundleItem.id) */
  id: string;
  /** Human-readable label, e.g. "Volume 3 (Ch. 20–30)" */
  label: string;
}

export type ModeSelection = "chapter" | "volume";

export interface BundleItem {
  /** Display label shown to user e.g. "Chapter 1" or "Volume 3" */
  label: string;
  /** Opaque id used by Phase 3 to fetch pages */
  id: string;
}

export interface AuthResult {
  ok: boolean;
  /** true = source doesn't require auth OR session already valid */
  skipped: boolean;
  /** true when the user just successfully pasted a new cURL */
  justAuthenticated?: boolean;
}

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
