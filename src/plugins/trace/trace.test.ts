import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTraceStore } from "./index.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function openTestDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS traces (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          TEXT    NOT NULL,
      level       TEXT    NOT NULL,
      event       TEXT,
      msg         TEXT    NOT NULL,
      fields_json TEXT,
      run_id      TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS traces_ts_idx ON traces(ts);
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

describe("createTraceStore — insert + select round-trip", () => {
  test("inserted row is retrievable", () => {
    const store = createTraceStore({ db });
    const ts = new Date().toISOString();
    store.insert({ ts, level: "info", msg: "hello", event: "test.event" });

    const row = db
      .prepare<{ ts: string; level: string; msg: string; event: string | null }, []>(
        "SELECT ts, level, msg, event FROM traces LIMIT 1",
      )
      .get();

    expect(row?.ts).toBe(ts);
    expect(row?.level).toBe("info");
    expect(row?.msg).toBe("hello");
    expect(row?.event).toBe("test.event");
  });

  test("optional fields are nullable", () => {
    const store = createTraceStore({ db });
    store.insert({ ts: new Date().toISOString(), level: "warn", msg: "no event or fields" });
    const row = db
      .prepare<{ event: string | null; fields_json: string | null }, []>(
        "SELECT event, fields_json FROM traces LIMIT 1",
      )
      .get();
    expect(row?.event).toBeNull();
    expect(row?.fields_json).toBeNull();
  });
});

describe("createTraceStore — redaction", () => {
  test("cookies key is redacted in fields_json before insert", () => {
    const store = createTraceStore({ db });
    store.insert({
      ts: new Date().toISOString(),
      level: "info",
      msg: "req",
      fields_json: JSON.stringify({ cookies: "secret", url: "https://example.com" }),
    });
    const row = db
      .prepare<{ fields_json: string }, []>("SELECT fields_json FROM traces LIMIT 1")
      .get();
    const parsed = JSON.parse(row?.fields_json as string);
    expect(parsed.cookies).toBe("[REDACTED]");
    expect(parsed.url).toBe("https://example.com");
  });

  test("cf_clearance is redacted", () => {
    const store = createTraceStore({ db });
    store.insert({
      ts: new Date().toISOString(),
      level: "info",
      msg: "req",
      fields_json: JSON.stringify({ cf_clearance: "abcdef" }),
    });
    const row = db
      .prepare<{ fields_json: string }, []>("SELECT fields_json FROM traces LIMIT 1")
      .get();
    const parsed = JSON.parse(row?.fields_json as string);
    expect(parsed.cf_clearance).toBe("[REDACTED]");
  });

  test("useragent is redacted", () => {
    const store = createTraceStore({ db });
    store.insert({
      ts: new Date().toISOString(),
      level: "info",
      msg: "req",
      fields_json: JSON.stringify({ useragent: "Mozilla/5.0" }),
    });
    const row = db
      .prepare<{ fields_json: string }, []>("SELECT fields_json FROM traces LIMIT 1")
      .get();
    const parsed = JSON.parse(row?.fields_json as string);
    expect(parsed.useragent).toBe("[REDACTED]");
  });

  test("authorization is redacted", () => {
    const store = createTraceStore({ db });
    store.insert({
      ts: new Date().toISOString(),
      level: "info",
      msg: "req",
      fields_json: JSON.stringify({ authorization: "Bearer token123" }),
    });
    const row = db
      .prepare<{ fields_json: string }, []>("SELECT fields_json FROM traces LIMIT 1")
      .get();
    const parsed = JSON.parse(row?.fields_json as string);
    expect(parsed.authorization).toBe("[REDACTED]");
  });
});

describe("createTraceStore — purge", () => {
  test("purge(3) removes rows older than 3 days, keeps newer ones", () => {
    const store = createTraceStore({ db });

    // Insert a row 4 days old (should be purged).
    const oldTs = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare("INSERT INTO traces (ts, level, msg, run_id) VALUES (?, ?, ?, ?)").run(
      oldTs,
      "info",
      "old row",
      store.runId,
    );

    // Insert a row 1 hour old (should survive).
    const newTs = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.prepare("INSERT INTO traces (ts, level, msg, run_id) VALUES (?, ?, ?, ?)").run(
      newTs,
      "info",
      "new row",
      store.runId,
    );

    store.purge(3);

    const remaining = db
      .prepare<{ msg: string }, []>("SELECT msg FROM traces ORDER BY ts ASC")
      .all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.msg).toBe("new row");
  });
});

describe("createTraceStore — run_id", () => {
  test("run_id is a valid UUID v4", () => {
    const store = createTraceStore({ db });
    expect(store.runId).toMatch(UUID_RE);
  });

  test("run_id is stable across multiple inserts from the same store instance", () => {
    const store = createTraceStore({ db });
    const ts = new Date().toISOString();
    store.insert({ ts, level: "info", msg: "first" });
    store.insert({ ts, level: "warn", msg: "second" });

    const rows = db
      .prepare<{ run_id: string }, []>("SELECT run_id FROM traces ORDER BY id ASC")
      .all();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.run_id).toBe(store.runId);
    expect(rows[1]?.run_id).toBe(store.runId);
  });

  test("two separate store instances produce distinct run_ids", () => {
    const store1 = createTraceStore({ db });
    const store2 = createTraceStore({ db });
    expect(store1.runId).not.toBe(store2.runId);
  });
});
