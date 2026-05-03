// Public API for the history module.

export type {
  DownloadRecord,
  DownloadRow,
  GetChapterIdsFilter,
  HistoryFilter,
  IsVolumeFullyDownloadedFilter,
  RecordResult,
} from "./types.ts";

export {
  getDownloadedChapterIds,
  isVolumeFullyDownloaded,
  listHistory,
  recordDownloadedChapters,
} from "./service.ts";
