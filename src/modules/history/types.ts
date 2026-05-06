// History module types — schema defined in docs/models/history_model.md.

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

export interface DownloadRow {
  mangaId: string;
  mangaTitle: string;
  volume: string;
  chapterId: string;
  chapterNum: string;
  source: string;
  language: string;
  downloadedAt: number;
}

export interface GetChapterIdsFilter {
  mangaId: string;
  language: string;
}

export interface IsVolumeFullyDownloadedFilter {
  mangaId: string;
  volume: string;
  language: string;
  expectedChapterIds: ReadonlySet<string> | readonly string[];
}

export interface HistoryFilter {
  mangaId?: string | undefined;
  source?: string | undefined;
  language?: string | undefined;
}

/** Query for listing/clearing with LIKE title matching and limit support */
export interface HistoryQuery {
  /** LIKE pattern applied to manga_title (case-insensitive) */
  mangaTitle?: string | undefined;
  source?: string | undefined;
  /** 0 = unlimited */
  limit?: number | undefined;
}

export type RecordResult =
  | { ok: true; inserted: number }
  | { ok: false; inserted: number; rejected: DownloadRow[] };
