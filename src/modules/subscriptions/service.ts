// Subscriptions service — business logic delegating to repository.

import type { Db } from "@plugins/db/index.ts";
import {
  deleteSubscription,
  insertSubscription,
  querySubscriptions,
  updateLastSyncedAt,
  updatePaused,
} from "./repository.ts";
import type { ListSubscriptionsFilter, Subscription, SubscriptionRow } from "./types.ts";

export function addSubscription(db: Db, row: SubscriptionRow): void {
  insertSubscription(db, row);
}

export function removeSubscription(db: Db, source: string, mangaId: string): void {
  deleteSubscription(db, source, mangaId);
}

export function pauseSubscription(db: Db, source: string, mangaId: string): void {
  updatePaused(db, source, mangaId, true);
}

export function resumeSubscription(db: Db, source: string, mangaId: string): void {
  updatePaused(db, source, mangaId, false);
}

export function markSynced(db: Db, source: string, mangaId: string, at: number): void {
  updateLastSyncedAt(db, source, mangaId, at);
}

export function listSubscriptions(db: Db, filter?: ListSubscriptionsFilter): Subscription[] {
  return querySubscriptions(db, filter);
}
