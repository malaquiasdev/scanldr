import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations } from "@plugins/db/index.ts";
import type { Db } from "@plugins/db/index.ts";

let workDir: string;
let db: Db;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "scanldr-db-"));
  db = openDb(join(workDir, "test.db"));
});

afterEach(async () => {
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

describe("runMigrations", () => {
  test("boot with 0 applied migrations — creates _migrations table and applies all files", () => {
    runMigrations(db);

    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
      .get() as { name: string } | null;
    expect(row?.name).toBe("_migrations");

    const downloads = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='downloads'")
      .get() as { name: string } | null;
    expect(downloads?.name).toBe("downloads");

    const subscriptions = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='subscriptions'")
      .get() as { name: string } | null;
    expect(subscriptions?.name).toBe("subscriptions");

    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_unique_chapter'")
      .get() as { name: string } | null;
    expect(idx?.name).toBe("idx_unique_chapter");

    const rows = db
      .prepare<{ name: string }, []>("SELECT name FROM _migrations ORDER BY name")
      .all();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.name).toBe("001_create_downloads.sql");
    expect(rows[1]?.name).toBe("002_create_subscriptions.sql");
  });

  test("boot with subset of migrations applied — only runs pending ones", () => {
    // Manually bootstrap _migrations and apply only the first migration
    db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       TEXT    PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    db.exec(`
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
    `);
    db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
      "001_create_downloads.sql",
      Date.now(),
    );

    runMigrations(db);

    // Only 002 should have been applied now (plus the pre-existing 001)
    const rows = db
      .prepare<{ name: string }, []>("SELECT name FROM _migrations ORDER BY name")
      .all();
    expect(rows.map((r) => r.name)).toContain("002_create_subscriptions.sql");

    const subscriptions = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='subscriptions'")
      .get() as { name: string } | null;
    expect(subscriptions?.name).toBe("subscriptions");
  });

  test("re-run is idempotent — second runMigrations is a no-op", () => {
    runMigrations(db);

    const countBefore = (
      db.prepare<{ c: number }, []>("SELECT COUNT(*) AS c FROM _migrations").get() as {
        c: number;
      }
    ).c;

    runMigrations(db);

    const countAfter = (
      db.prepare<{ c: number }, []>("SELECT COUNT(*) AS c FROM _migrations").get() as {
        c: number;
      }
    ).c;

    expect(countAfter).toBe(countBefore);
  });
});
