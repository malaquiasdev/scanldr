// DB plugin — opens SQLite and applies versioned migrations from migrations/*.sql.

import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Db, MigrationRow } from "./types.ts";

export type { Db } from "./types.ts";

const MIGRATIONS_DIR = resolve(import.meta.dir, "../../../migrations");

const BOOTSTRAP_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS _migrations (
  name       TEXT    PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
`;

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  return db;
}

export function runMigrations(db: Db): void {
  db.exec(BOOTSTRAP_MIGRATIONS_TABLE);

  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch (err) {
    throw new Error(
      `migrations directory not found at ${MIGRATIONS_DIR}: ${(err as Error).message}`,
    );
  }

  const applied = new Set(
    db
      .prepare<MigrationRow, []>("SELECT name, applied_at FROM _migrations")
      .all()
      .map((r) => r.name),
  );

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");

    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(file, Date.now());
    })();
  }
}
