// Subscriptions module types — schema defined in docs/models/subscription_model.md.

export interface Subscription {
  source: string;
  mangaId: string;
  mangaTitle: string;
  paused: boolean;
  addedAt: number;
  lastSyncedAt: number | null;
}

export interface AddSubscriptionInput {
  source: string;
  mangaId: string;
  mangaTitle: string;
}

export interface RemoveSubscriptionInput {
  source: string;
  mangaId: string;
}

export interface SetPausedInput {
  source: string;
  mangaId: string;
  paused: boolean;
}

export interface MarkSyncedInput {
  source: string;
  mangaId: string;
  at: number;
}

export interface RefreshTitleInput {
  source: string;
  mangaId: string;
  title: string;
}

export interface ListSubscriptionsFilter {
  includePaused?: boolean;
}
