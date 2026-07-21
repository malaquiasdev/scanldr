import { getSource, SOURCES } from "../../sources/index.ts";
import type { SourceDescriptor } from "../../sources/types.ts";
import { select } from "../prompts.ts";

/**
 * Step 2: let the user pick a source.
 * With a single registered source there's nothing to choose — auto-select it and skip
 * a dead 1-option prompt. Stays robust if more sources are registered later.
 */
export async function pickSource(): Promise<SourceDescriptor> {
  if (SOURCES.length === 1) {
    const only = SOURCES[0];
    if (!only) throw new Error("SOURCES is unexpectedly empty");
    return only;
  }

  const id = await select<string>({
    message: "Choose a source:",
    choices: SOURCES.map((s) => ({ name: s.label, value: s.id })),
  });
  return getSource(id);
}
