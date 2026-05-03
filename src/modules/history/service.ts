// History service — SQLite queries and migrations via bun:sqlite.

import { Database } from "bun:sqlite";
import type {
  DownloadRecord,
  DownloadRow,
  GetChapterIdsFilter,
  HistoryFilter,
  IsVolumeFullyDownloadedFilter,
  RecordResult,
} from "./types.ts";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS downloads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  manga_id      TEXT    NOT NULL,
  manga_title   TEXT    NOT NULL,
  volume        TEXT    NOT NULL,
  chapter_id    TEXT    NOT NULL,
  chapter_num   TEXT    NOT NULL,
  source        TEXT    NOT NULL,
  language      TEXT    NOT NULL,
  downloaded_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_chapter
  ON downloads (manga_id, chapter_id, source, language);
`;

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

export function runMigration(db: Database): void {
  db.exec(MIGRATION);
}

export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  runMigration(db);
  return db;
}

export function getDownloadedChapterIds(db: Database, filter: GetChapterIdsFilter): Set<string> {
  const stmt = db.prepare<{ chapter_id: string }, [string, string]>(
    "SELECT chapter_id FROM downloads WHERE manga_id = ? AND language = ?",
  );
  const rows = stmt.all(filter.mangaId, filter.language);
  return new Set(rows.map((r) => r.chapter_id));
}

export function isVolumeFullyDownloaded(
  db: Database,
  filter: IsVolumeFullyDownloadedFilter,
): boolean {
  const expected =
    filter.expectedChapterIds instanceof Set
      ? filter.expectedChapterIds
      : new Set(filter.expectedChapterIds);

  if (expected.size === 0) return false;

  const stmt = db.prepare<{ chapter_id: string }, [string, string, string]>(
    "SELECT chapter_id FROM downloads WHERE manga_id = ? AND volume = ? AND language = ?",
  );
  const rows = stmt.all(filter.mangaId, filter.volume, filter.language);
  const downloaded = new Set(rows.map((r) => r.chapter_id));

  for (const id of expected) {
    if (!downloaded.has(id)) return false;
  }
  return true;
}

export function recordDownloadedChapters(db: Database, rows: DownloadRow[]): RecordResult {
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

export function listHistory(db: Database, filter?: HistoryFilter): DownloadRecord[] {
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
