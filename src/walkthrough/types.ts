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
