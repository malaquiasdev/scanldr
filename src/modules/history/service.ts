// History service — business logic delegating to repository.

import type { Db } from "@plugins/db/index.ts";
import {
  insertDownloads,
  queryDownloadedChapterIds,
  queryHistory,
  queryVolumeChapterIds,
} from "./repository.ts";
import type {
  DownloadRecord,
  DownloadRow,
  GetChapterIdsFilter,
  HistoryFilter,
  IsVolumeFullyDownloadedFilter,
  RecordResult,
} from "./types.ts";

export function getDownloadedChapterIds(db: Db, filter: GetChapterIdsFilter): Set<string> {
  return queryDownloadedChapterIds(db, filter);
}

export function isVolumeFullyDownloaded(db: Db, filter: IsVolumeFullyDownloadedFilter): boolean {
  const expected =
    filter.expectedChapterIds instanceof Set
      ? filter.expectedChapterIds
      : new Set(filter.expectedChapterIds);

  if (expected.size === 0) return false;

  const downloaded = queryVolumeChapterIds(db, filter);

  for (const id of expected) {
    if (!downloaded.has(id)) return false;
  }
  return true;
}

export function recordDownloadedChapters(db: Db, rows: DownloadRow[]): RecordResult {
  return insertDownloads(db, rows);
}

export function listHistory(db: Db, filter?: HistoryFilter): DownloadRecord[] {
  return queryHistory(db, filter);
}
