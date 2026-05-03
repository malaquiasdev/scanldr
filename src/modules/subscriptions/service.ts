// Subscriptions service — business logic delegating to repository.

import type { Db } from "@plugins/db/index.ts";
import {
  deleteSubscription,
  insertSubscription,
  querySubscriptions,
  updateLastSyncedAt,
  updateMangaTitle,
  updatePaused,
} from "./repository.ts";
import type {
  AddSubscriptionInput,
  ListSubscriptionsFilter,
  MarkSyncedInput,
  RefreshTitleInput,
  RemoveSubscriptionInput,
  SetPausedInput,
  Subscription,
} from "./types.ts";

export function addSubscription(db: Db, input: AddSubscriptionInput): void {
  insertSubscription(db, input, Date.now());
}

export function removeSubscription(db: Db, input: RemoveSubscriptionInput): boolean {
  return deleteSubscription(db, input.source, input.mangaId);
}

export function setPaused(db: Db, input: SetPausedInput): boolean {
  return updatePaused(db, input.source, input.mangaId, input.paused);
}

export function markSynced(db: Db, input: MarkSyncedInput): void {
  updateLastSyncedAt(db, input.source, input.mangaId, input.at);
}

export function refreshTitle(db: Db, input: RefreshTitleInput): void {
  updateMangaTitle(db, input.source, input.mangaId, input.title);
}

export function listSubscriptions(db: Db, filter?: ListSubscriptionsFilter): Subscription[] {
  return querySubscriptions(db, filter);
}
