import { createInterface } from "node:readline";
import { CliError } from "@plugins/errors/index.ts";
import type { PackPromptOptions, PackPromptResult } from "./types.ts";

export type { PackPromptOptions, PackPromptResult };

// All prompts write to stderr so they are never interleaved with pino's stdout
// logs (pino writes to stdout; stderr is flushed independently by the kernel).

/**
 * Ask a yes/no question on stderr.
 * Returns true for 'y' / 'Y', false for everything else (empty = default No).
 */
function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    // Write prompt text to stderr before readline reads a line so the question
    // always appears before the cursor — no dependency on pino flush timing.
    process.stderr.write(question);
    rl.once("line", (line) => {
      rl.close();
      resolve(line.trim().toLowerCase() === "y");
    });
  });
}

/** Path-traversal guard: same rules as --pack <name> in pack.ts. */
function isUnsafeVolumeName(input: string): boolean {
  return (
    input.includes("/") ||
    input.includes("\\") ||
    input.split(/[\\/]/).some((s) => s === "..")
  );
}

/**
 * Ask for a volume number/name stem.
 * Re-prompts on unsafe input.
 * Returns the sanitised input, or undefined if the user left it blank (→ default).
 */
async function promptVolumeName(hint: string): Promise<string | undefined> {
  while (true) {
    const answer = await new Promise<string>((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      process.stderr.write(`Volume number (leave blank for "${hint}"): `);
      rl.once("line", (line) => {
        rl.close();
        resolve(line.trim());
      });
    });

    if (answer === "") return undefined;

    if (isUnsafeVolumeName(answer)) {
      process.stderr.write(
        `Invalid volume name — cannot contain '/', '\\' or '..' segments. Try again.\n`,
      );
      continue;
    }

    return answer;
  }
}

/**
 * Orchestrates the two-step pack prompt (or non-interactive flag path).
 *
 * Returns { shouldPack, shouldDelete, volumeName }.
 * Throws CliError when the target file exists in non-interactive mode and --pack-overwrite was not passed.
 */
export async function runPackPrompts(opts: PackPromptOptions): Promise<PackPromptResult> {
  const {
    chapterCount,
    outputName,
    defaultVolumeStem,
    checkExists,
    nonTty,
    packFlag,
    packNameProvided,
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

  // Volume-number prompt: only in interactive TTY mode when no explicit name was provided
  let volumeName: string | undefined;
  const askVolumeNumber = !nonTty && !packNameProvided && !packReplace;
  if (askVolumeNumber) {
    const input = await promptVolumeName(defaultVolumeStem);
    if (input !== undefined) {
      volumeName = input;
    }
  }

  // Re-derive the effective output name if the user chose a custom volume number
  const effectiveOutputName =
    volumeName !== undefined
      ? volumeName.endsWith(".cbz")
        ? volumeName
        : `${volumeName}.cbz`
      : outputName;

  // Check for existing file against the *effective* path (post-name-prompt) to avoid silent overwrites.
  const fileExists = await checkExists(effectiveOutputName);
  if (fileExists) {
    if (nonTty && !packOverwrite) {
      throw new CliError(
        `${effectiveOutputName} already exists; pass --pack-overwrite or remove the file`,
        1,
      );
    }
    if (!nonTty && !packOverwrite) {
      const overwrite = await promptYesNo(
        `${effectiveOutputName} already exists. Overwrite? [y/N] `,
      );
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

  return { shouldPack: true, shouldDelete, volumeName };
}
