// Types for the history CLI command.

export interface HistoryListArgs {
  manga: string | undefined;
  source: string | undefined;
  /** 0 = unlimited, default 50 */
  limit: number;
}

export interface HistoryClearArgs {
  manga: string | undefined;
  source: string | undefined;
  /** Skip interactive confirmation */
  yes: boolean;
}
