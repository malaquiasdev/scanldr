import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Logger } from "@plugins/logger/index.ts";
import { createSourceCache } from "@plugins/source-cache/index.ts";
import { createCachedAdapter } from "./cached-adapter.ts";
import type { ChapterListing, SearchHit, SourceAdapter } from "./types.ts";

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

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

const searchHits: SearchHit[] = [
  { id: "1", title: "One Piece", originalLanguage: "ja", year: 1997 },
];
const chapters: ChapterListing[] = [{ id: "c1", num: "1", label: "Chapter 1" }];

function makeFakeAdapter(): {
  adapter: SourceAdapter;
  searchFn: ReturnType<typeof mock>;
  listChaptersFn: ReturnType<typeof mock>;
} {
  const searchFn = mock(async (): Promise<SearchHit[]> => searchHits);
  const listChaptersFn = mock(async (): Promise<ChapterListing[]> => chapters);
  const fetchChapterInput = mock(async () => {
    throw new Error("not exercised in these tests");
  });
  return {
    adapter: { search: searchFn, listChapters: listChaptersFn, fetchChapterInput },
    searchFn,
    listChaptersFn,
  };
}

let db: Database;

beforeEach(() => {
  db = openTestDb();
});

afterEach(() => {
  db.close();
});

describe("createCachedAdapter — search", () => {
  test("miss calls the network adapter and persists the result", async () => {
    const cache = createSourceCache({ db });
    const { adapter, searchFn } = makeFakeAdapter();
    const cached = createCachedAdapter({
      adapter,
      cache,
      source: "mangakakalot",
      logger: noopLogger,
    });

    const result = await cached.search("One Piece");

    expect(result).toEqual(searchHits);
    expect(searchFn).toHaveBeenCalledTimes(1);
  });

  test("hit within TTL never calls the network adapter", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const cache = createSourceCache({ db, now: () => now });
    const { adapter, searchFn } = makeFakeAdapter();
    const cached = createCachedAdapter({
      adapter,
      cache,
      source: "mangakakalot",
      logger: noopLogger,
      now: () => now,
    });

    await cached.search("One Piece");
    expect(searchFn).toHaveBeenCalledTimes(1);

    const second = await cached.search("One Piece");
    expect(second).toEqual(searchHits);
    expect(searchFn).toHaveBeenCalledTimes(1); // still 1 — no network call on hit
  });

  test("expired cache re-fetches and overwrites", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const cache = createSourceCache({ db, now: () => now });
    const { adapter, searchFn } = makeFakeAdapter();
    const cached = createCachedAdapter({
      adapter,
      cache,
      source: "mangakakalot",
      logger: noopLogger,
      ttlDays: { search: 15, chapterList: 15 },
      now: () => now,
    });

    await cached.search("One Piece");
    expect(searchFn).toHaveBeenCalledTimes(1);

    now = new Date("2026-01-20T00:00:00.000Z"); // 19 days later — past 15d TTL
    await cached.search("One Piece");
    expect(searchFn).toHaveBeenCalledTimes(2);
  });

  test("force-refresh bypasses a fresh cache entry", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const cache = createSourceCache({ db, now: () => now });
    const { adapter, searchFn } = makeFakeAdapter();
    const cached = createCachedAdapter({
      adapter,
      cache,
      source: "mangakakalot",
      logger: noopLogger,
      forceRefresh: true,
      now: () => now,
    });

    await cached.search("One Piece");
    await cached.search("One Piece");
    expect(searchFn).toHaveBeenCalledTimes(2);
  });

  test("normalizes the query for the cache key (case/whitespace-insensitive hit)", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const cache = createSourceCache({ db, now: () => now });
    const { adapter, searchFn } = makeFakeAdapter();
    const cached = createCachedAdapter({
      adapter,
      cache,
      source: "mangakakalot",
      logger: noopLogger,
      now: () => now,
    });

    await cached.search("  One Piece  ");
    await cached.search("one piece");
    expect(searchFn).toHaveBeenCalledTimes(1);
  });
});

describe("createCachedAdapter — listChapters", () => {
  test("hit within TTL never calls the network adapter", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const cache = createSourceCache({ db, now: () => now });
    const { adapter, listChaptersFn } = makeFakeAdapter();
    const cached = createCachedAdapter({
      adapter,
      cache,
      source: "mangakakalot",
      logger: noopLogger,
      now: () => now,
    });

    await cached.listChapters("manga-1");
    await cached.listChapters("manga-1");
    expect(listChaptersFn).toHaveBeenCalledTimes(1);
  });

  test("expired cache re-fetches and overwrites", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const cache = createSourceCache({ db, now: () => now });
    const { adapter, listChaptersFn } = makeFakeAdapter();
    const cached = createCachedAdapter({
      adapter,
      cache,
      source: "mangakakalot",
      logger: noopLogger,
      now: () => now,
    });

    await cached.listChapters("manga-1");
    now = new Date("2026-01-20T00:00:00.000Z");
    await cached.listChapters("manga-1");
    expect(listChaptersFn).toHaveBeenCalledTimes(2);
  });

  test("force-refresh bypasses a fresh cache entry", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const cache = createSourceCache({ db, now: () => now });
    const { adapter, listChaptersFn } = makeFakeAdapter();
    const cached = createCachedAdapter({
      adapter,
      cache,
      source: "mangakakalot",
      logger: noopLogger,
      forceRefresh: true,
      now: () => now,
    });

    await cached.listChapters("manga-1");
    await cached.listChapters("manga-1");
    expect(listChaptersFn).toHaveBeenCalledTimes(2);
  });

  test("per-type TTL is independent — expired chapter TTL doesn't affect search cache", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const cache = createSourceCache({ db, now: () => now });
    const { adapter, searchFn, listChaptersFn } = makeFakeAdapter();
    const cached = createCachedAdapter({
      adapter,
      cache,
      source: "mangakakalot",
      logger: noopLogger,
      ttlDays: { search: 15, chapterList: 5 },
      now: () => now,
    });

    await cached.search("One Piece");
    await cached.listChapters("manga-1");

    now = new Date("2026-01-08T00:00:00.000Z"); // 7 days later: chapter TTL (5d) expired, search TTL (15d) not
    await cached.search("One Piece");
    await cached.listChapters("manga-1");

    expect(searchFn).toHaveBeenCalledTimes(1);
    expect(listChaptersFn).toHaveBeenCalledTimes(2);
  });
});

describe("createCachedAdapter — fetchChapterInput", () => {
  test("passes through untouched (not cached)", async () => {
    const cache = createSourceCache({ db });
    const { adapter } = makeFakeAdapter();
    const cached = createCachedAdapter({
      adapter,
      cache,
      source: "mangakakalot",
      logger: noopLogger,
    });

    await expect(cached.fetchChapterInput("c1")).rejects.toThrow("not exercised in these tests");
  });
});
