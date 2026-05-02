// Shared types — schemas defined in docs/models/*.md.

export interface AuthConfig {
  cookies: Record<string, string>;
  userAgent: string;
  savedAt: number;
}

export interface ChapterRef {
  id: string;
  number: string;
  numeric: number;
  url: string;
  language: string;
  scanlationGroup?: string;
}

export interface VolumeRef {
  number: string;
  numeric: number;
  chapters: ChapterRef[];
}

export interface MangaInfo {
  id: string;
  title: string;
  url: string;
  volumes: VolumeRef[];
  source: string;
}

export interface DownloadOptions {
  outDir: string;
  format: "cbz" | "zip";
  imageConcurrency: number;
  delayMs: number;
  force: boolean;
  dryRun: boolean;
}

export interface DownloadRecord {
  id: number;
  mangaId: string;
  mangaTitle: string;
  volume: string;
  chapterId: string;
  chapterNum: string;
  source: string;
  language: string;
  downloadedAt: number;
}

export interface Subscription {
  source: string;
  mangaId: string;
  mangaTitle: string;
  paused: boolean;
  addedAt: number;
  lastSyncedAt: number | null;
}
