import { SOURCES } from "../../sources/registry.ts";
import type { SourceDescriptor } from "../../sources/types.ts";
import { select } from "../prompts.ts";

/** Step 2: let the user pick a source. */
export async function pickSource(): Promise<SourceDescriptor> {
  const id = await select<string>({
    message: "Choose a source:",
    choices: SOURCES.map((s) => ({ name: s.label, value: s.id })),
  });
  // getSource() would work, but we already have SOURCES here — avoid extra call
  const found = SOURCES.find((s) => s.id === id);
  if (!found) throw new Error(`Unexpected source id: ${id}`);
  return found;
}
