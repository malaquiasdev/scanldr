import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSourceCache, isExpired, normalizeQuery } from "./index.ts";

function openTestDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_cache (
      source       TEXT NOT NULL,
      payload_type TEXT NOT NULL,
      key          TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      fetched_at   TEXT NOT NULL,
      PRIMARY KEY (source, payload_type, key)
    );
  `);
  return db;
}

let db: Database;

beforeEach(() => {
  db = openTestDb();
});

afterEach(() => {
  db.close();
});

describe("createSourceCache", () => {
  test("returns null on miss", () => {
    const cache = createSourceCache({ db });
    expect(cache.get("search", "mangakakalot", "one piece")).toBeNull();
  });

  test("set + get round-trips the payload and fetchedAt", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const cache = createSourceCache({ db, now: () => now });
    cache.set("search", "mangakakalot", "one piece", [{ id: "1", title: "One Piece" }]);

    const hit = cache.get<{ id: string; title: string }[]>("search", "mangakakalot", "one piece");
    expect(hit).not.toBeNull();
    expect(hit?.payload).toEqual([{ id: "1", title: "One Piece" }]);
    expect(hit?.fetchedAt.toISOString()).toBe(now.toISOString());
  });

  test("set overwrites an existing row for the same (source, type, key)", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const cache = createSourceCache({ db, now: () => now });
    cache.set("chapter-list", "mangakakalot", "manga-1", [{ id: "c1" }]);

    now = new Date("2026-01-05T00:00:00.000Z");
    cache.set("chapter-list", "mangakakalot", "manga-1", [{ id: "c1" }, { id: "c2" }]);

    const hit = cache.get<{ id: string }[]>("chapter-list", "mangakakalot", "manga-1");
    expect(hit?.payload).toEqual([{ id: "c1" }, { id: "c2" }]);
    expect(hit?.fetchedAt.toISOString()).toBe(now.toISOString());
  });

  test("payload types are isolated — same key, different type, no collision", () => {
    const cache = createSourceCache({ db });
    cache.set("search", "mangakakalot", "abc", ["search-payload"]);
    cache.set("chapter-list", "mangakakalot", "abc", ["chapters-payload"]);

    expect(cache.get("search", "mangakakalot", "abc")?.payload).toEqual(["search-payload"]);
    expect(cache.get("chapter-list", "mangakakalot", "abc")?.payload).toEqual(["chapters-payload"]);
  });
});

describe("isExpired", () => {
  test("false when within TTL", () => {
    const fetchedAt = new Date("2026-01-01T00:00:00.000Z");
    const now = () => new Date("2026-01-10T00:00:00.000Z"); // 9 days later
    expect(isExpired(fetchedAt, 15, now)).toBe(false);
  });

  test("true when past TTL", () => {
    const fetchedAt = new Date("2026-01-01T00:00:00.000Z");
    const now = () => new Date("2026-01-20T00:00:00.000Z"); // 19 days later
    expect(isExpired(fetchedAt, 15, now)).toBe(true);
  });

  test("boundary — exactly at TTL is not expired", () => {
    const fetchedAt = new Date("2026-01-01T00:00:00.000Z");
    const now = () => new Date("2026-01-16T00:00:00.000Z"); // exactly 15 days
    expect(isExpired(fetchedAt, 15, now)).toBe(false);
  });
});

describe("normalizeQuery", () => {
  test("trims, lowercases, collapses whitespace", () => {
    expect(normalizeQuery("  One   Piece  ")).toBe("one piece");
  });
});
