// Output formatter for history list — no ANSI colors, pipe-friendly.

import type { DownloadRecord } from "@modules/history/index.ts";

const TITLE_MAX = 30;
const CHAPTER_COL = 12; // "ch. <num>" padded

function padEnd(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function formatTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export function formatHistoryRow(record: DownloadRecord): string {
  const ts = formatTimestamp(record.downloadedAt);
  const title = padEnd(record.mangaTitle, TITLE_MAX);
  const chapter = padEnd(`ch. ${record.chapterNum}`, CHAPTER_COL);
  return `${ts}  ${title}  ${chapter}  ${record.source}`;
}

export function formatHistoryLines(records: DownloadRecord[]): string {
  return records.map(formatHistoryRow).join("\n");
}
