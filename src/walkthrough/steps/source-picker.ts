import { SOURCES, getSource } from "../../sources/index.ts";
import type { SourceDescriptor } from "../../sources/types.ts";
import { select } from "../prompts.ts";

/** Step 2: let the user pick a source. */
export async function pickSource(): Promise<SourceDescriptor> {
  const id = await select<string>({
    message: "Choose a source:",
    choices: SOURCES.map((s) => ({ name: s.label, value: s.id })),
  });
  return getSource(id);
}
