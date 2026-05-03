// Subscriptions module types — schema defined in docs/models/subscription_model.md.

export interface Subscription {
  source: string;
  mangaId: string;
  mangaTitle: string;
  paused: boolean;
  addedAt: number;
  lastSyncedAt: number | null;
}

export interface SubscriptionRow {
  source: string;
  mangaId: string;
  mangaTitle: string;
  paused: boolean;
  addedAt: number;
}

export interface ListSubscriptionsFilter {
  paused?: boolean | undefined;
}
