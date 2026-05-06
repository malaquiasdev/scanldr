import { createInterface } from "node:readline";
import type { Logger } from "@plugins/logger/index.ts";

/**
 * Ask a yes/no question on stderr.
 * Returns true for 'y' / 'Y', false for everything else (empty = default No).
 */
function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write(question);
    rl.once("line", (line) => {
      rl.close();
      resolve(line.trim().toLowerCase() === "y");
    });
  });
}

export interface PackPromptResult {
  shouldPack: boolean;
  shouldDelete: boolean;
}

export interface PackPromptOptions {
  chapterCount: number;
  outputName: string;
  /** true if the target file already exists */
  fileExists: boolean;
  nonTty: boolean;
  /** --pack flag (boolean form — pack with default name, keep individuals) */
  packFlag: boolean;
  /** --pack-replace flag (pack + delete individuals) */
  packReplace: boolean;
  /** --pack-overwrite flag (overwrite if exists) */
  packOverwrite: boolean;
  logger: Logger;
}

/**
 * Orchestrates the two-step pack prompt (or non-interactive flag path).
 *
 * Returns { shouldPack, shouldDelete }.
 * Throws CliError when the target file exists in non-interactive mode and --pack-overwrite was not passed.
 */
export async function runPackPrompts(opts: PackPromptOptions): Promise<PackPromptResult> {
  const {
    chapterCount,
    outputName,
    fileExists,
    nonTty,
    packFlag,
    packReplace,
    packOverwrite,
    logger,
  } = opts;

  // N == 1: skip silently
  if (chapterCount <= 1) {
    logger.info(
      { event: "pack.skipped", context: "pack", reason: "single_chapter" },
      "single chapter — skipping pack prompt",
    );
    return { shouldPack: false, shouldDelete: false };
  }

  // Non-TTY without explicit flag: skip
  if (nonTty && !packFlag && !packReplace) {
    logger.info(
      { event: "pack.skipped", context: "pack", reason: "non_tty" },
      "non-TTY and no --pack flag — skipping pack",
    );
    return { shouldPack: false, shouldDelete: false };
  }

  // Determine if we should pack
  let shouldPack: boolean;
  if (packFlag || packReplace) {
    shouldPack = true;
  } else {
    // Interactive prompt
    shouldPack = await promptYesNo(
      `Pack ${chapterCount} chapters into a single volume file? [y/N] `,
    );
  }

  if (!shouldPack) {
    logger.info(
      { event: "pack.skipped", context: "pack", reason: "user_declined" },
      "user declined pack",
    );
    return { shouldPack: false, shouldDelete: false };
  }

  // Check for existing file
  if (fileExists) {
    if (nonTty && !packOverwrite) {
      const { CliError } = await import("@plugins/errors/index.ts");
      throw new CliError(
        `${outputName} already exists; pass --pack-overwrite or remove the file`,
        1,
      );
    }
    if (!nonTty && !packOverwrite) {
      const overwrite = await promptYesNo(`${outputName} already exists. Overwrite? [y/N] `);
      if (!overwrite) {
        logger.info(
          { event: "pack.skipped", context: "pack", reason: "overwrite_declined" },
          "user declined overwrite",
        );
        return { shouldPack: false, shouldDelete: false };
      }
    }
  }

  // Determine if we should delete individuals
  let shouldDelete: boolean;
  if (packReplace) {
    shouldDelete = true;
    // Print info instead of prompting when --pack-replace
    process.stderr.write("(individual files will be deleted — --pack-replace was passed)\n");
  } else if (nonTty) {
    shouldDelete = false;
    process.stderr.write(
      "(individual files kept by default — pass --pack-replace to delete them)\n",
    );
  } else {
    shouldDelete = await promptYesNo("Delete individual chapter files? [y/N] ");
  }

  return { shouldPack: true, shouldDelete };
}
