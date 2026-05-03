import { createInterface } from "node:readline";
import { CliError } from "./range.ts";
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
    throw new CliError(
      `no preferred language available (preferred: ${preferred.join(", ")}; available: ${available.join(", ")}); set preferred_languages in scanldr.json`,
      2,
    );
  }

  return promptLanguagePick(available);
}
