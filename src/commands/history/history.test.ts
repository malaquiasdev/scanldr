import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHistoryClear, runHistoryList } from "@commands/history/index.ts";
import { recordDownloadedChapters } from "@modules/history/index.ts";
import type { DownloadRow } from "@modules/history/index.ts";
import { openDb, runMigrations } from "@plugins/db/index.ts";
import type { Db } from "@plugins/db/index.ts";

let workDir: string;
let db: Db;

const BASE: DownloadRow = {
  mangaId: "manga-1",
  mangaTitle: "Dandadan",
  volume: "1",
  chapterId: "ch-001",
  chapterNum: "111",
  source: "mangakakalot",
  language: "en",
  downloadedAt: 1_746_500_000_000,
};

function seed(overrides: Partial<DownloadRow>[] = []): void {
  const rows = overrides.length > 0 ? overrides.map((o) => ({ ...BASE, ...o })) : [BASE];
  recordDownloadedChapters(db, rows);
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "scanldr-history-cmd-"));
  db = openDb(join(workDir, "test.db"));
  runMigrations(db);
});

afterEach(async () => {
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

// Capture stdout/stderr output during a call
async function capture(fn: () => Promise<void>): Promise<{ out: string; err: string }> {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);

  // biome-ignore lint/suspicious/noExplicitAny: overriding write for capture
  (process.stdout as any).write = (chunk: unknown) => {
    outChunks.push(String(chunk));
    return true;
  };
  // biome-ignore lint/suspicious/noExplicitAny: overriding write for capture
  (process.stderr as any).write = (chunk: unknown) => {
    errChunks.push(String(chunk));
    return true;
  };

  try {
    await fn();
  } finally {
    // biome-ignore lint/suspicious/noExplicitAny: restoring write
    (process.stdout as any).write = origOut;
    // biome-ignore lint/suspicious/noExplicitAny: restoring write
    (process.stderr as any).write = origErr;
  }

  return { out: outChunks.join(""), err: errChunks.join("") };
}

describe("runHistoryList", () => {
  test("empty db prints (no entries) to stderr, exit 0", async () => {
    const { err, out } = await capture(() =>
      runHistoryList({ manga: undefined, source: undefined, limit: 50 }, db),
    );
    expect(err).toBe("(no entries)\n");
    expect(out).toBe("");
  });

  test("lists records sorted by downloaded_at DESC", async () => {
    seed([
      { chapterId: "ch-001", chapterNum: "107", downloadedAt: 1_000 },
      { chapterId: "ch-002", chapterNum: "111", downloadedAt: 3_000 },
      { chapterId: "ch-003", chapterNum: "109", downloadedAt: 2_000 },
    ]);

    const { out } = await capture(() =>
      runHistoryList({ manga: undefined, source: undefined, limit: 50 }, db),
    );

    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(3);
    // First line should be most recent (ch-002 / 111)
    expect(lines[0]).toContain("ch. 111");
    // Last line oldest (ch-001 / 107)
    expect(lines[2]).toContain("ch. 107");
  });

  test("--limit 2 returns only 2 rows", async () => {
    seed([
      { chapterId: "ch-001", chapterNum: "107", downloadedAt: 1_000 },
      { chapterId: "ch-002", chapterNum: "108", downloadedAt: 2_000 },
      { chapterId: "ch-003", chapterNum: "109", downloadedAt: 3_000 },
    ]);

    const { out } = await capture(() =>
      runHistoryList({ manga: undefined, source: undefined, limit: 2 }, db),
    );
    expect(out.trim().split("\n")).toHaveLength(2);
  });

  test("--limit 0 returns all rows", async () => {
    seed([
      { chapterId: "ch-001", downloadedAt: 1_000 },
      { chapterId: "ch-002", downloadedAt: 2_000 },
      { chapterId: "ch-003", downloadedAt: 3_000 },
    ]);

    const { out } = await capture(() =>
      runHistoryList({ manga: undefined, source: undefined, limit: 0 }, db),
    );
    expect(out.trim().split("\n")).toHaveLength(3);
  });

  test("--manga filters by LIKE case-insensitive", async () => {
    seed([
      { chapterId: "ch-001", mangaTitle: "Dandadan", downloadedAt: 1_000 },
      { chapterId: "ch-002", mangaTitle: "One Piece", downloadedAt: 2_000 },
    ]);

    const { out } = await capture(() =>
      runHistoryList({ manga: "danda", source: undefined, limit: 50 }, db),
    );
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Dandadan");
  });

  test("--source filters by source", async () => {
    seed([
      { chapterId: "ch-001", source: "mangakakalot", downloadedAt: 1_000 },
      { chapterId: "ch-002", source: "mangadex", downloadedAt: 2_000 },
    ]);

    const { out } = await capture(() =>
      runHistoryList({ manga: undefined, source: "mangadex", limit: 50 }, db),
    );
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("mangadex");
  });

  test("--manga and --source combined (AND)", async () => {
    seed([
      { chapterId: "ch-001", mangaTitle: "Dandadan", source: "mangakakalot", downloadedAt: 1_000 },
      { chapterId: "ch-002", mangaTitle: "Dandadan", source: "mangadex", downloadedAt: 2_000 },
      { chapterId: "ch-003", mangaTitle: "One Piece", source: "mangakakalot", downloadedAt: 3_000 },
    ]);

    const { out } = await capture(() =>
      runHistoryList({ manga: "Dandadan", source: "mangakakalot", limit: 50 }, db),
    );
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Dandadan");
    expect(lines[0]).toContain("mangakakalot");
  });

  test("output format contains timestamp, title, ch. num, source", async () => {
    seed([{ chapterId: "ch-001", chapterNum: "111", downloadedAt: 1_746_500_000_000 }]);

    const { out } = await capture(() =>
      runHistoryList({ manga: undefined, source: undefined, limit: 50 }, db),
    );
    const line = out.trim();
    expect(line).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(line).toContain("ch. 111");
    expect(line).toContain("mangakakalot");
    expect(line).toContain("Dandadan");
  });
});

describe("runHistoryClear", () => {
  test("no matching records prints (no entries) to stderr", async () => {
    const { err, out } = await capture(() =>
      runHistoryClear({ manga: "NonExistent", source: undefined, yes: true }, db),
    );
    expect(err).toBe("(no entries matching filter)\n");
    expect(out).toBe("");
  });

  test("--yes with --manga filter deletes matching records", async () => {
    seed([
      { chapterId: "ch-001", mangaTitle: "Dandadan", downloadedAt: 1_000 },
      { chapterId: "ch-002", mangaTitle: "One Piece", downloadedAt: 2_000 },
    ]);

    const { out } = await capture(() =>
      runHistoryClear({ manga: "Dandadan", source: undefined, yes: true }, db),
    );
    expect(out).toContain("Deleted 1 record");

    // Only One Piece should remain
    const remaining = await capture(() =>
      runHistoryList({ manga: undefined, source: undefined, limit: 50 }, db),
    );
    expect(remaining.out).toContain("One Piece");
    expect(remaining.out).not.toContain("Dandadan");
  });

  test("--yes with --source filter deletes by source", async () => {
    seed([
      { chapterId: "ch-001", source: "mangakakalot", downloadedAt: 1_000 },
      { chapterId: "ch-002", source: "mangadex", downloadedAt: 2_000 },
    ]);

    const { out } = await capture(() =>
      runHistoryClear({ manga: undefined, source: "mangadex", yes: true }, db),
    );
    expect(out).toContain("Deleted 1 record");
  });

  test("--yes with no filter deletes all records", async () => {
    seed([
      { chapterId: "ch-001", downloadedAt: 1_000 },
      { chapterId: "ch-002", downloadedAt: 2_000 },
      { chapterId: "ch-003", downloadedAt: 3_000 },
    ]);

    const { out } = await capture(() =>
      runHistoryClear({ manga: undefined, source: undefined, yes: true }, db),
    );
    expect(out).toContain("Deleted 3 records");

    const { err } = await capture(() =>
      runHistoryList({ manga: undefined, source: undefined, limit: 50 }, db),
    );
    expect(err).toBe("(no entries)\n");
  });

  test("non-TTY without --yes throws CliError with helpful message", async () => {
    seed();
    // Simulate non-TTY by overriding isTTY
    const orig = process.stdin.isTTY;
    // biome-ignore lint/suspicious/noExplicitAny: patching isTTY for test
    (process.stdin as any).isTTY = false;
    try {
      await expect(
        runHistoryClear({ manga: undefined, source: undefined, yes: false }, db),
      ).rejects.toThrow("History clear requires confirmation. Pass --yes for non-interactive use.");
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: restoring isTTY
      (process.stdin as any).isTTY = orig;
    }
  });
});
