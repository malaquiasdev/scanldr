import type { Config } from "@plugins/config/index.ts";
import type { Db } from "@plugins/db/index.ts";
import type { Logger } from "@plugins/logger/index.ts";

export interface HandlerContext {
  logger: Logger;
  db: Db;
  config: Config;
}

export type Handler = (rest: string[], ctx: HandlerContext) => Promise<void> | void;
