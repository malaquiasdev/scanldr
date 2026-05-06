// Public API for the history module.

export type {
  DownloadRecord,
  DownloadRow,
  GetChapterIdsFilter,
  HistoryFilter,
  HistoryQuery,
  IsVolumeFullyDownloadedFilter,
  RecordResult,
} from "./types.ts";

export {
  clearHistory,
  countHistory,
  getDownloadedChapterIds,
  isVolumeFullyDownloaded,
  listHistory,
  listHistoryPaged,
  recordDownloadedChapters,
} from "./service.ts";
