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
  pauseSubscription,
  removeSubscription,
  resumeSubscription,
} from "./service.ts";
import type { SubscriptionRow } from "./types.ts";

let workDir: string;
let db: Db;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "scanldr-subs-"));
  db = openDb(join(workDir, "test.db"));
  runMigrations(db);
});

afterEach(async () => {
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

const BASE_SUB: SubscriptionRow = {
  source: "mangadex",
  mangaId: "manga-uuid-1",
  mangaTitle: "One Piece",
  paused: false,
  addedAt: 1_700_000_000_000,
};

describe("addSubscription / listSubscriptions", () => {
  test("inserts a subscription and lists it back", () => {
    addSubscription(db, BASE_SUB);
    const subs = listSubscriptions(db);
    expect(subs).toHaveLength(1);
    expect(subs[0]?.mangaId).toBe(BASE_SUB.mangaId);
    expect(subs[0]?.mangaTitle).toBe(BASE_SUB.mangaTitle);
    expect(subs[0]?.source).toBe(BASE_SUB.source);
    expect(subs[0]?.paused).toBe(false);
    expect(subs[0]?.lastSyncedAt).toBeNull();
  });

  test("duplicate insert is idempotent — no duplicate rows", () => {
    addSubscription(db, BASE_SUB);
    addSubscription(db, BASE_SUB);
    const subs = listSubscriptions(db);
    expect(subs).toHaveLength(1);
  });
});

describe("pauseSubscription / resumeSubscription", () => {
  test("pause sets paused=true", () => {
    addSubscription(db, BASE_SUB);
    pauseSubscription(db, BASE_SUB.source, BASE_SUB.mangaId);
    const [sub] = listSubscriptions(db);
    expect(sub?.paused).toBe(true);
  });

  test("resume sets paused=false after pause", () => {
    addSubscription(db, { ...BASE_SUB, paused: true });
    resumeSubscription(db, BASE_SUB.source, BASE_SUB.mangaId);
    const [sub] = listSubscriptions(db);
    expect(sub?.paused).toBe(false);
  });
});

describe("markSynced", () => {
  test("updates last_synced_at", () => {
    addSubscription(db, BASE_SUB);
    const syncedAt = 1_700_001_000_000;
    markSynced(db, BASE_SUB.source, BASE_SUB.mangaId, syncedAt);
    const [sub] = listSubscriptions(db);
    expect(sub?.lastSyncedAt).toBe(syncedAt);
  });
});

describe("removeSubscription", () => {
  test("removes the subscription row", () => {
    addSubscription(db, BASE_SUB);
    removeSubscription(db, BASE_SUB.source, BASE_SUB.mangaId);
    expect(listSubscriptions(db)).toHaveLength(0);
  });

  test("_migrations table is unaffected after remove", () => {
    addSubscription(db, BASE_SUB);
    removeSubscription(db, BASE_SUB.source, BASE_SUB.mangaId);
    const rows = db.prepare("SELECT name FROM _migrations").all() as { name: string }[];
    expect(rows.length).toBeGreaterThan(0);
  });

  test("downloads table is unaffected after remove", () => {
    // seed a download row so the table exists and has data
    db.prepare(
      `INSERT INTO downloads (manga_id, manga_title, volume, chapter_id, chapter_num, source, language, downloaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("manga-uuid-1", "One Piece", "1", "ch-001", "1", "mangadex", "en", 1_700_000_000_000);

    addSubscription(db, BASE_SUB);
    removeSubscription(db, BASE_SUB.source, BASE_SUB.mangaId);

    const rows = db.prepare("SELECT chapter_id FROM downloads").all() as { chapter_id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.chapter_id).toBe("ch-001");
  });
});

describe("listSubscriptions with paused filter", () => {
  beforeEach(() => {
    addSubscription(db, { ...BASE_SUB, mangaId: "manga-1", mangaTitle: "A", paused: false });
    addSubscription(db, { ...BASE_SUB, mangaId: "manga-2", mangaTitle: "B", paused: true });
    addSubscription(db, { ...BASE_SUB, mangaId: "manga-3", mangaTitle: "C", paused: false });
  });

  test("no filter returns all subscriptions", () => {
    expect(listSubscriptions(db)).toHaveLength(3);
  });

  test("paused=true returns only paused", () => {
    const subs = listSubscriptions(db, { paused: true });
    expect(subs).toHaveLength(1);
    expect(subs[0]?.mangaId).toBe("manga-2");
  });

  test("paused=false returns only active", () => {
    const subs = listSubscriptions(db, { paused: false });
    expect(subs).toHaveLength(2);
    expect(subs.every((s) => s.paused === false)).toBe(true);
  });
});
