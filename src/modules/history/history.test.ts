import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getDownloadedChapterIds,
  isVolumeFullyDownloaded,
  listHistory,
  recordDownloadedChapters,
} from "@modules/history/index.ts";
import type { DownloadRow } from "@modules/history/index.ts";
import { openDb, runMigrations } from "@plugins/db/index.ts";
import type { Db } from "@plugins/db/index.ts";

let workDir: string;
let db: Db;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "scanldr-history-"));
  db = openDb(join(workDir, "test.db"));
  runMigrations(db);
});

afterEach(async () => {
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

const BASE_ROW: DownloadRow = {
  mangaId: "manga-uuid-1",
  mangaTitle: "One Piece",
  volume: "1",
  chapterId: "ch-001",
  chapterNum: "1",
  source: "mangadex",
  language: "en",
  downloadedAt: 1_700_000_000_000,
};

describe("openDb / migration", () => {
  test("creates downloads table on first open", () => {
    const stmt = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='downloads'",
    );
    const row = stmt.get() as { name: string } | null;
    expect(row?.name).toBe("downloads");
  });

  test("migration is idempotent — running twice does not error", () => {
    runMigrations(db);
  });

  test("creates unique index idx_unique_chapter", () => {
    const stmt = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_unique_chapter'",
    );
    const row = stmt.get() as { name: string } | null;
    expect(row?.name).toBe("idx_unique_chapter");
  });
});

describe("recordDownloadedChapters", () => {
  test("inserts a single row and returns ok=true", () => {
    const result = recordDownloadedChapters(db, [BASE_ROW]);
    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(1);
  });

  test("inserts a batch of rows atomically", () => {
    const rows: DownloadRow[] = [
      { ...BASE_ROW, chapterId: "ch-001" },
      { ...BASE_ROW, chapterId: "ch-002" },
      { ...BASE_ROW, chapterId: "ch-003" },
    ];
    const result = recordDownloadedChapters(db, rows);
    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(3);
  });

  test("duplicate insert returns ok=false with rejected rows", () => {
    recordDownloadedChapters(db, [BASE_ROW]);
    const result = recordDownloadedChapters(db, [BASE_ROW]);
    expect(result.ok).toBe(false);
    expect(result.inserted).toBe(0);
    if (!result.ok) {
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]?.chapterId).toBe(BASE_ROW.chapterId);
    }
  });

  test("partial batch: new rows inserted, duplicates returned as rejected", () => {
    recordDownloadedChapters(db, [{ ...BASE_ROW, chapterId: "ch-001" }]);

    const rows: DownloadRow[] = [
      { ...BASE_ROW, chapterId: "ch-001" }, // duplicate
      { ...BASE_ROW, chapterId: "ch-002" }, // new
    ];
    const result = recordDownloadedChapters(db, rows);
    expect(result.ok).toBe(false);
    expect(result.inserted).toBe(1);
    if (!result.ok) {
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]?.chapterId).toBe("ch-001");
    }
  });

  test("empty batch returns ok=true with inserted=0", () => {
    const result = recordDownloadedChapters(db, []);
    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(0);
  });
});

describe("getDownloadedChapterIds", () => {
  test("returns empty set for empty db", () => {
    const ids = getDownloadedChapterIds(db, { mangaId: "manga-uuid-1", language: "en" });
    expect(ids.size).toBe(0);
  });

  test("returns chapter ids matching mangaId + language", () => {
    recordDownloadedChapters(db, [
      { ...BASE_ROW, chapterId: "ch-001" },
      { ...BASE_ROW, chapterId: "ch-002" },
      { ...BASE_ROW, mangaId: "other-manga", chapterId: "ch-999" },
      { ...BASE_ROW, chapterId: "ch-003", language: "pt-BR" },
    ]);

    const ids = getDownloadedChapterIds(db, { mangaId: "manga-uuid-1", language: "en" });
    expect(ids).toEqual(new Set(["ch-001", "ch-002"]));
  });
});

describe("isVolumeFullyDownloaded", () => {
  test("returns false for empty db", () => {
    const result = isVolumeFullyDownloaded(db, {
      mangaId: "manga-uuid-1",
      volume: "1",
      language: "en",
      expectedChapterIds: new Set(["ch-001", "ch-002"]),
    });
    expect(result).toBe(false);
  });

  test("returns false when expectedChapterIds is empty", () => {
    const result = isVolumeFullyDownloaded(db, {
      mangaId: "manga-uuid-1",
      volume: "1",
      language: "en",
      expectedChapterIds: [],
    });
    expect(result).toBe(false);
  });

  test("returns true when all expected chapters are downloaded", () => {
    recordDownloadedChapters(db, [
      { ...BASE_ROW, chapterId: "ch-001" },
      { ...BASE_ROW, chapterId: "ch-002" },
    ]);

    const result = isVolumeFullyDownloaded(db, {
      mangaId: "manga-uuid-1",
      volume: "1",
      language: "en",
      expectedChapterIds: new Set(["ch-001", "ch-002"]),
    });
    expect(result).toBe(true);
  });

  test("returns false when some expected chapters are missing", () => {
    recordDownloadedChapters(db, [{ ...BASE_ROW, chapterId: "ch-001" }]);

    const result = isVolumeFullyDownloaded(db, {
      mangaId: "manga-uuid-1",
      volume: "1",
      language: "en",
      expectedChapterIds: new Set(["ch-001", "ch-002"]),
    });
    expect(result).toBe(false);
  });

  test("accepts array for expectedChapterIds", () => {
    recordDownloadedChapters(db, [{ ...BASE_ROW, chapterId: "ch-001" }]);
    const result = isVolumeFullyDownloaded(db, {
      mangaId: "manga-uuid-1",
      volume: "1",
      language: "en",
      expectedChapterIds: ["ch-001"],
    });
    expect(result).toBe(true);
  });
});

describe("listHistory", () => {
  beforeEach(() => {
    recordDownloadedChapters(db, [
      { ...BASE_ROW, chapterId: "ch-001", source: "mangadex", language: "en" },
      { ...BASE_ROW, chapterId: "ch-002", source: "mangadex", language: "en" },
      {
        ...BASE_ROW,
        mangaId: "manga-uuid-2",
        mangaTitle: "Naruto",
        chapterId: "ch-010",
        source: "mangakakalot",
        language: "pt-BR",
      },
    ]);
  });

  test("returns all records when no filter provided", () => {
    const records = listHistory(db);
    expect(records).toHaveLength(3);
  });

  test("filters by mangaId", () => {
    const records = listHistory(db, { mangaId: "manga-uuid-1" });
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.mangaId === "manga-uuid-1")).toBe(true);
  });

  test("filters by source", () => {
    const records = listHistory(db, { source: "mangakakalot" });
    expect(records).toHaveLength(1);
    expect(records[0]?.source).toBe("mangakakalot");
  });

  test("filters by language", () => {
    const records = listHistory(db, { language: "pt-BR" });
    expect(records).toHaveLength(1);
    expect(records[0]?.language).toBe("pt-BR");
  });

  test("combines multiple filters", () => {
    const records = listHistory(db, { source: "mangadex", language: "en" });
    expect(records).toHaveLength(2);
  });

  test("returns empty array when no match", () => {
    const records = listHistory(db, { mangaId: "does-not-exist" });
    expect(records).toHaveLength(0);
  });

  test("maps snake_case columns to camelCase", () => {
    const [record] = listHistory(db, { mangaId: "manga-uuid-1" });
    expect(record).toBeDefined();
    expect(record?.mangaId).toBe("manga-uuid-1");
    expect(record?.mangaTitle).toBe("One Piece");
    expect(record?.chapterId).toBeDefined();
    expect(record?.downloadedAt).toBe(BASE_ROW.downloadedAt);
  });
});
