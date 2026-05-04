import { createInterface } from "node:readline";
import { CliError } from "@plugins/errors/index.ts";
import type { Logger } from "@plugins/logger/index.ts";

export interface NumericChoiceOptions {
  /** The header line shown above the numbered list. */
  header: string;
  /** The items to enumerate. */
  items: ReadonlyArray<{ display: string }>;
  /** Logger for warn-before-throw on invalid input. */
  logger: Logger;
  /** Optional context label for the warn payload (e.g. "download.candidate"). */
  event?: string;
}

/**
 * Interactive numeric picker. Reads from process.stdin / writes to process.stderr.
 * Throws CliError on invalid input. Caller is responsible for nonTty gate.
 * Returns the 0-based index of the chosen item.
 */
export function promptNumericChoice(opts: NumericChoiceOptions): Promise<number> {
  const { header, items, logger, event = "download.invalid_selection" } = opts;
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const list = items.map((item, i) => `  [${i + 1}] ${item.display}`).join("\n");
    process.stderr.write(`${header}\n${list}\nPick one: `);
    rl.once("line", (line) => {
      rl.close();
      const input = line.trim();
      const n = Number.parseInt(input, 10);
      if (Number.isNaN(n) || n < 1 || n > items.length) {
        logger.warn(
          { event, context: "download", input, count: items.length },
          `invalid selection: "${input}"`,
        );
        reject(new CliError(`Invalid selection: "${input}"`, 2));
      } else {
        resolve(n - 1);
      }
    });
  });
}
