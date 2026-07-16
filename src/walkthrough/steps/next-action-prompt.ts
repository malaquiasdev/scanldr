import { select } from "../prompts.ts";

export type NextAction = "same-manga" | "new-manga" | "quit";

/** Post-download step: offer to keep going with the same manga, search a new one, or quit. */
export async function promptNextAction(): Promise<NextAction> {
  const result = await select<NextAction>({
    message: "Done. What next?",
    choices: [
      { name: "Same manga — pick another chapter range", value: "same-manga" },
      { name: "New manga — search again", value: "new-manga" },
      { name: "Quit", value: "quit" },
    ],
  });
  return result;
}
