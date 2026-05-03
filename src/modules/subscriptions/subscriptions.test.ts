import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations } from "@plugins/db/index.ts";
import type { Db } from "@plugins/db/index.ts";
import {
  addSubscription,
  listSubscriptions,
  markSynced,
  refreshTitle,
  removeSubscription,
  setPaused,
} from "./service.ts";

let workDir: string;
let db: Db;

const SOURCE = "mangadex";
const MANGA_ID = "manga-uuid-1";
const MANGA_TITLE = "One Piece";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "scanldr-subs-"));
  db = openDb(join(workDir, "test.db"));
  runMigrations(db);
});

afterEach(async () => {
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

describe("addSubscription / listSubscriptions", () => {
  test("inserts a subscription and lists it back", () => {
    addSubscription(db, { source: SOURCE, mangaId: MANGA_ID, mangaTitle: MANGA_TITLE });
    const subs = listSubscriptions(db);
    expect(subs).toHaveLength(1);
    expect(subs[0]?.mangaId).toBe(MANGA_ID);
    expect(subs[0]?.mangaTitle).toBe(MANGA_TITLE);
    expect(subs[0]?.source).toBe(SOURCE);
    expect(subs[0]?.paused).toBe(false);
    expect(subs[0]?.lastSyncedAt).toBeNull();
  });

  test("addedAt is set close to Date.now() and paused is false", () => {
    const before = Date.now();
    addSubscription(db, { source: SOURCE, mangaId: MANGA_ID, mangaTitle: MANGA_TITLE });
    const after = Date.now();
    const [sub] = listSubscriptions(db);
    expect(sub?.paused).toBe(false);
    expect(sub?.addedAt).toBeGreaterThanOrEqual(before);
    expect(sub?.addedAt).toBeLessThanOrEqual(after + 1000);
  });

  test("duplicate insert is idempotent — no duplicate rows", () => {
    addSubscription(db, { source: SOURCE, mangaId: MANGA_ID, mangaTitle: MANGA_TITLE });
    addSubscription(db, { source: SOURCE, mangaId: MANGA_ID, mangaTitle: MANGA_TITLE });
    const subs = listSubscriptions(db);
    expect(subs).toHaveLength(1);
  });
});

describe("removeSubscription", () => {
  test("returns true when row existed", () => {
    addSubscription(db, { source: SOURCE, mangaId: MANGA_ID, mangaTitle: MANGA_TITLE });
    const result = removeSubscription(db, { source: SOURCE, mangaId: MANGA_ID });
    expect(result).toBe(true);
    expect(listSubscriptions(db)).toHaveLength(0);
  });

  test("returns false when row does not exist", () => {
    const result = removeSubscription(db, { source: SOURCE, mangaId: "nonexistent" });
    expect(result).toBe(false);
  });

  test("_migrations table is unaffected after remove", () => {
    addSubscription(db, { source: SOURCE, mangaId: MANGA_ID, mangaTitle: MANGA_TITLE });
    removeSubscription(db, { source: SOURCE, mangaId: MANGA_ID });
    const rows = db.prepare("SELECT name FROM _migrations").all() as { name: string }[];
    expect(rows.length).toBeGreaterThan(0);
  });

  test("downloads table is unaffected after remove", () => {
    db.prepare(
      `INSERT INTO downloads (manga_id, manga_title, volume, chapter_id, chapter_num, source, language, downloaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(MANGA_ID, MANGA_TITLE, "1", "ch-001", "1", SOURCE, "en", 1_700_000_000_000);

    addSubscription(db, { source: SOURCE, mangaId: MANGA_ID, mangaTitle: MANGA_TITLE });
    removeSubscription(db, { source: SOURCE, mangaId: MANGA_ID });

    const rows = db.prepare("SELECT chapter_id FROM downloads").all() as { chapter_id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.chapter_id).toBe("ch-001");
  });
});

describe("setPaused", () => {
  test("returns true when row was updated", () => {
    addSubscription(db, { source: SOURCE, mangaId: MANGA_ID, mangaTitle: MANGA_TITLE });
    const result = setPaused(db, { source: SOURCE, mangaId: MANGA_ID, paused: true });
    expect(result).toBe(true);
  });

  test("returns false when row does not exist", () => {
    const result = setPaused(db, { source: SOURCE, mangaId: "nonexistent", paused: true });
    expect(result).toBe(false);
  });

  test("toggles paused correctly from false to true", () => {
    addSubscription(db, { source: SOURCE, mangaId: MANGA_ID, mangaTitle: MANGA_TITLE });
    setPaused(db, { source: SOURCE, mangaId: MANGA_ID, paused: true });
    // need includePaused to see it
    const subs = listSubscriptions(db, { includePaused: true });
    expect(subs[0]?.paused).toBe(true);
  });

  test("toggles paused correctly from true to false", () => {
    addSubscription(db, { source: SOURCE, mangaId: MANGA_ID, mangaTitle: MANGA_TITLE });
    setPaused(db, { source: SOURCE, mangaId: MANGA_ID, paused: true });
    setPaused(db, { source: SOURCE, mangaId: MANGA_ID, paused: false });
    const [sub] = listSubscriptions(db);
    expect(sub?.paused).toBe(false);
  });

  test("preserves mangaTitle, addedAt, lastSyncedAt after setPaused", () => {
    addSubscription(db, { source: SOURCE, mangaId: MANGA_ID, mangaTitle: MANGA_TITLE });
    const syncedAt = 1_700_001_000_000;
    markSynced(db, { source: SOURCE, mangaId: MANGA_ID, at: syncedAt });

    setPaused(db, { source: SOURCE, mangaId: MANGA_ID, paused: true });
    const [sub] = listSubscriptions(db, { includePaused: true });

    expect(sub?.mangaTitle).toBe(MANGA_TITLE);
    expect(sub?.lastSyncedAt).toBe(syncedAt);
    expect(typeof sub?.addedAt).toBe("number");
  });
});

describe("markSynced", () => {
  test("updates last_synced_at", () => {
    addSubscription(db, { source: SOURCE, mangaId: MANGA_ID, mangaTitle: MANGA_TITLE });
    const syncedAt = 1_700_001_000_000;
    markSynced(db, { source: SOURCE, mangaId: MANGA_ID, at: syncedAt });
    const [sub] = listSubscriptions(db);
    expect(sub?.lastSyncedAt).toBe(syncedAt);
  });

  test("does not change paused, mangaTitle, or addedAt", () => {
    addSubscription(db, { source: SOURCE, mangaId: MANGA_ID, mangaTitle: MANGA_TITLE });
    const [before] = listSubscriptions(db);
    const syncedAt = 1_700_001_000_000;
    markSynced(db, { source: SOURCE, mangaId: MANGA_ID, at: syncedAt });
    const [after] = listSubscriptions(db);
    expect(after?.paused).toBe(false);
    expect(after?.mangaTitle).toBe(MANGA_TITLE);
    expect(after?.addedAt).toBe(before?.addedAt);
    expect(after?.lastSyncedAt).toBe(syncedAt);
  });
});

describe("refreshTitle", () => {
  test("updates only manga_title", () => {
    addSubscription(db, { source: SOURCE, mangaId: MANGA_ID, mangaTitle: MANGA_TITLE });
    const syncedAt = 1_700_001_000_000;
    markSynced(db, { source: SOURCE, mangaId: MANGA_ID, at: syncedAt });
    const [before] = listSubscriptions(db);

    refreshTitle(db, { source: SOURCE, mangaId: MANGA_ID, title: "One Piece (Revised)" });
    const [after] = listSubscriptions(db);

    expect(after?.mangaTitle).toBe("One Piece (Revised)");
    expect(after?.paused).toBe(before?.paused);
    expect(after?.addedAt).toBe(before?.addedAt);
    expect(after?.lastSyncedAt).toBe(syncedAt);
  });
});

describe("listSubscriptions", () => {
  beforeEach(() => {
    addSubscription(db, { source: SOURCE, mangaId: "manga-1", mangaTitle: "A" });
    addSubscription(db, { source: SOURCE, mangaId: "manga-2", mangaTitle: "B" });
    addSubscription(db, { source: SOURCE, mangaId: "manga-3", mangaTitle: "C" });
    setPaused(db, { source: SOURCE, mangaId: "manga-2", paused: true });
  });

  test("default returns only active (non-paused)", () => {
    const subs = listSubscriptions(db);
    expect(subs).toHaveLength(2);
    expect(subs.every((s) => s.paused === false)).toBe(true);
  });

  test("includePaused: true returns all", () => {
    const subs = listSubscriptions(db, { includePaused: true });
    expect(subs).toHaveLength(3);
  });

  test("ordering by manga_title is stable", () => {
    const subs = listSubscriptions(db, { includePaused: true });
    expect(subs.map((s) => s.mangaTitle)).toEqual(["A", "B", "C"]);
  });
});
