// CLI dispatcher for history list and history clear commands.

import { clearHistory, countHistory, listHistoryPaged } from "@modules/history/index.ts";
import type { Db } from "@plugins/db/index.ts";
import { CliError } from "@plugins/errors/index.ts";
import { formatHistoryLines } from "./format.ts";
import { promptTypeDelete, promptYesNo } from "./prompt.ts";
import type { HistoryClearArgs, HistoryListArgs } from "./types.ts";

export type { HistoryClearArgs, HistoryListArgs } from "./types.ts";

export async function runHistoryList(args: HistoryListArgs, db: Db): Promise<void> {
  const records = listHistoryPaged(db, {
    mangaTitle: args.manga,
    source: args.source,
    limit: args.limit,
  });

  if (records.length === 0) {
    process.stderr.write("(no entries)\n");
    return;
  }

  process.stdout.write(`${formatHistoryLines(records)}\n`);
}

export async function runHistoryClear(args: HistoryClearArgs, db: Db): Promise<void> {
  const hasFilter = args.manga !== undefined || args.source !== undefined;

  const count = countHistory(db, {
    mangaTitle: args.manga,
    source: args.source,
  });

  if (count === 0) {
    process.stderr.write("(no entries matching filter)\n");
    return;
  }

  if (!args.yes) {
    // Non-TTY without --yes is not supported — bail early with clear error message.
    if (!process.stdin.isTTY) {
      throw new CliError(
        "History clear requires confirmation. Pass --yes for non-interactive use.",
        2,
      );
    }

    let confirmed: boolean;

    if (hasFilter) {
      const filterDesc = [
        args.manga ? `"${args.manga}"` : undefined,
        args.source ? `source=${args.source}` : undefined,
      ]
        .filter(Boolean)
        .join(", ");

      confirmed = await promptYesNo(
        `This will delete ${count} download record${count === 1 ? "" : "s"} for ${filterDesc}. Continue?`,
      );
    } else {
      // No filter = clear all — reinforced confirmation
      confirmed = await promptTypeDelete(
        `This will delete ALL ${count} download records. This cannot be undone.`,
      );
    }

    if (!confirmed) {
      process.stderr.write("Aborted.\n");
      return;
    }
  }

  const deleted = clearHistory(db, {
    mangaTitle: args.manga,
    source: args.source,
  });

  process.stdout.write(`✓ Deleted ${deleted} record${deleted === 1 ? "" : "s"}\n`);
}
