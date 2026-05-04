import { createInterface } from "node:readline";
import { CliError } from "@plugins/errors/index.ts";
import type { ResolveLanguageInput } from "./types.ts";

function promptLanguagePick(available: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const list = available.map((lang, i) => `  [${i + 1}] ${lang}`).join("\n");
    process.stderr.write(`No preferred language available. Choose one:\n${list}\nPick one: `);
    rl.once("line", (line) => {
      rl.close();
      const n = Number.parseInt(line.trim(), 10);
      if (Number.isNaN(n) || n < 1 || n > available.length) {
        reject(new CliError(`Invalid selection: "${line.trim()}"`, 2));
      } else {
        resolve(available[n - 1] as string);
      }
    });
  });
}

export async function resolveLanguage(input: ResolveLanguageInput): Promise<string> {
  const { preferred, available, nonTty, logger } = input;

  if (available.length === 0) {
    logger.warn(
      { event: "download.no_chapters", context: "download", preferred },
      "chapter feed returned no languages; manga may have only metadata",
    );
    throw new CliError(
      'No chapters available for this manga in any language. Try `scanldr list "<manga>"` to verify.',
      2,
    );
  }

  for (const lang of preferred) {
    if (available.includes(lang)) {
      logger.info(
        { event: "download.language_resolved", context: "download", language: lang },
        "language resolved from preferences",
      );
      return lang;
    }
  }

  if (nonTty) {
    logger.warn(
      { event: "download.no_preferred_language", context: "download", preferred, available },
      "no preferred language matches available chapters; failing because non-TTY",
    );
    throw new CliError(
      `no preferred language available (preferred: ${preferred.join(", ")}; available: ${available.join(", ")}); set preferred_languages in scanldr.json`,
      2,
    );
  }

  return promptLanguagePick(available);
}
