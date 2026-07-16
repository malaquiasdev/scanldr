import { confirm } from "../prompts.ts";

/** Step 7: ask whether to group chapters into a single volume. */
export async function promptPack(): Promise<boolean> {
  return confirm({
    message: "Group these chapters into a single volume?",
    default: true,
  });
}
