// DB plugin types.

import type { Database } from "bun:sqlite";

export type Db = Database;

export interface MigrationRow {
  name: string;
  applied_at: number;
}
