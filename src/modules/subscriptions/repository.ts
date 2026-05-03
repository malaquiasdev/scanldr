// Subscriptions repository — raw SQL queries, no business logic.

import type { Db } from "@plugins/db/index.ts";
import type { AddSubscriptionInput, ListSubscriptionsFilter, Subscription } from "./types.ts";

function toSubscription(raw: {
  source: string;
  manga_id: string;
  manga_title: string;
  paused: number;
  added_at: number;
  last_synced_at: number | null;
}): Subscription {
  return {
    source: raw.source,
    mangaId: raw.manga_id,
    mangaTitle: raw.manga_title,
    paused: raw.paused === 1,
    addedAt: raw.added_at,
    lastSyncedAt: raw.last_synced_at,
  };
}

export function insertSubscription(db: Db, input: AddSubscriptionInput, addedAt: number): void {
  db.prepare(
    `INSERT OR IGNORE INTO subscriptions (source, manga_id, manga_title, paused, added_at)
     VALUES (?, ?, ?, 0, ?)`,
  ).run(input.source, input.mangaId, input.mangaTitle, addedAt);
}

export function deleteSubscription(db: Db, source: string, mangaId: string): boolean {
  const info = db
    .prepare("DELETE FROM subscriptions WHERE source = ? AND manga_id = ?")
    .run(source, mangaId);
  return info.changes > 0;
}

export function updatePaused(db: Db, source: string, mangaId: string, paused: boolean): boolean {
  const info = db
    .prepare("UPDATE subscriptions SET paused = ? WHERE source = ? AND manga_id = ?")
    .run(paused ? 1 : 0, source, mangaId);
  return info.changes > 0;
}

export function updateLastSyncedAt(
  db: Db,
  source: string,
  mangaId: string,
  lastSyncedAt: number,
): void {
  db.prepare("UPDATE subscriptions SET last_synced_at = ? WHERE source = ? AND manga_id = ?").run(
    lastSyncedAt,
    source,
    mangaId,
  );
}

export function updateMangaTitle(db: Db, source: string, mangaId: string, title: string): void {
  db.prepare("UPDATE subscriptions SET manga_title = ? WHERE source = ? AND manga_id = ?").run(
    title,
    source,
    mangaId,
  );
}

export function querySubscriptions(db: Db, filter?: ListSubscriptionsFilter): Subscription[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  // default: active only unless includePaused is explicitly true
  if (!filter?.includePaused) {
    conditions.push("paused = 0");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT source, manga_id, manga_title, paused, added_at, last_synced_at
               FROM subscriptions ${where} ORDER BY manga_title`;

  const stmt = db.prepare(sql);
  const raw = stmt.all(...params) as {
    source: string;
    manga_id: string;
    manga_title: string;
    paused: number;
    added_at: number;
    last_synced_at: number | null;
  }[];

  return raw.map(toSubscription);
}
