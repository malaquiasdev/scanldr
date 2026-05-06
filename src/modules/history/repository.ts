// History repository — raw SQL queries, no business logic.

import type { Db } from "@plugins/db/index.ts";
import type {
  DownloadRecord,
  DownloadRow,
  GetChapterIdsFilter,
  HistoryFilter,
  HistoryQuery,
  IsVolumeFullyDownloadedFilter,
  RecordResult,
} from "./types.ts";

function toRecord(raw: {
  id: number;
  manga_id: string;
  manga_title: string;
  volume: string;
  chapter_id: string;
  chapter_num: string;
  source: string;
  language: string;
  downloaded_at: number;
}): DownloadRecord {
  return {
    id: raw.id,
    mangaId: raw.manga_id,
    mangaTitle: raw.manga_title,
    volume: raw.volume,
    chapterId: raw.chapter_id,
    chapterNum: raw.chapter_num,
    source: raw.source,
    language: raw.language,
    downloadedAt: raw.downloaded_at,
  };
}

export function queryDownloadedChapterIds(db: Db, filter: GetChapterIdsFilter): Set<string> {
  const stmt = db.prepare<{ chapter_id: string }, [string, string]>(
    "SELECT chapter_id FROM downloads WHERE manga_id = ? AND language = ?",
  );
  const rows = stmt.all(filter.mangaId, filter.language);
  return new Set(rows.map((r) => r.chapter_id));
}

export function queryVolumeChapterIds(db: Db, filter: IsVolumeFullyDownloadedFilter): Set<string> {
  const stmt = db.prepare<{ chapter_id: string }, [string, string, string]>(
    "SELECT chapter_id FROM downloads WHERE manga_id = ? AND volume = ? AND language = ?",
  );
  const rows = stmt.all(filter.mangaId, filter.volume, filter.language);
  return new Set(rows.map((r) => r.chapter_id));
}

export function insertDownloads(db: Db, rows: DownloadRow[]): RecordResult {
  if (rows.length === 0) return { ok: true, inserted: 0 };

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO downloads
       (manga_id, manga_title, volume, chapter_id, chapter_num, source, language, downloaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let inserted = 0;
  const rejected: DownloadRow[] = [];

  const run = db.transaction(() => {
    for (const row of rows) {
      const result = stmt.run(
        row.mangaId,
        row.mangaTitle,
        row.volume,
        row.chapterId,
        row.chapterNum,
        row.source,
        row.language,
        row.downloadedAt,
      );
      if (result.changes > 0) {
        inserted++;
      } else {
        rejected.push(row);
      }
    }
  });

  run();

  if (rejected.length > 0) {
    return { ok: false, inserted, rejected };
  }
  return { ok: true, inserted };
}

export function queryHistory(db: Db, filter?: HistoryFilter): DownloadRecord[] {
  const conditions: string[] = [];
  const params: string[] = [];

  if (filter?.mangaId !== undefined) {
    conditions.push("manga_id = ?");
    params.push(filter.mangaId);
  }
  if (filter?.source !== undefined) {
    conditions.push("source = ?");
    params.push(filter.source);
  }
  if (filter?.language !== undefined) {
    conditions.push("language = ?");
    params.push(filter.language);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT * FROM downloads ${where} ORDER BY manga_title, CAST(volume AS REAL)`;

  const stmt = db.prepare(sql);
  const raw = stmt.all(...params) as {
    id: number;
    manga_id: string;
    manga_title: string;
    volume: string;
    chapter_id: string;
    chapter_num: string;
    source: string;
    language: string;
    downloaded_at: number;
  }[];

  return raw.map(toRecord);
}

/** List downloads with LIKE title matching, source filter, and a row limit. */
export function queryHistoryList(db: Db, query: HistoryQuery): DownloadRecord[] {
  const conditions: string[] = [];
  // Parameterized to prevent SQL injection; user input never concatenated into SQL.
  const params: (string | number)[] = [];

  if (query.mangaTitle !== undefined) {
    conditions.push("manga_title LIKE ? COLLATE NOCASE");
    params.push(`%${query.mangaTitle}%`);
  }
  if (query.source !== undefined) {
    conditions.push("source = ?");
    params.push(query.source);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitClause = query.limit !== undefined && query.limit > 0 ? `LIMIT ${query.limit}` : "";
  const sql = `SELECT * FROM downloads ${where} ORDER BY downloaded_at DESC ${limitClause}`.trim();

  const stmt = db.prepare(sql);
  const raw = stmt.all(...params) as {
    id: number;
    manga_id: string;
    manga_title: string;
    volume: string;
    chapter_id: string;
    chapter_num: string;
    source: string;
    language: string;
    downloaded_at: number;
  }[];

  return raw.map(toRecord);
}

/** Count matching downloads — used to show the count before confirmation. */
export function countHistoryMatches(db: Db, query: Omit<HistoryQuery, "limit">): number {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (query.mangaTitle !== undefined) {
    conditions.push("manga_title LIKE ? COLLATE NOCASE");
    params.push(`%${query.mangaTitle}%`);
  }
  if (query.source !== undefined) {
    conditions.push("source = ?");
    params.push(query.source);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT COUNT(*) as cnt FROM downloads ${where}`.trim();

  const stmt = db.prepare(sql);
  const row = stmt.get(...params) as { cnt: number };
  return row.cnt;
}

/** Delete matching downloads. Returns number of deleted rows. */
export function deleteHistory(db: Db, query: Omit<HistoryQuery, "limit">): number {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (query.mangaTitle !== undefined) {
    conditions.push("manga_title LIKE ? COLLATE NOCASE");
    params.push(`%${query.mangaTitle}%`);
  }
  if (query.source !== undefined) {
    conditions.push("source = ?");
    params.push(query.source);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `DELETE FROM downloads ${where}`.trim();

  const stmt = db.prepare(sql);
  const result = stmt.run(...params);
  return result.changes;
}
