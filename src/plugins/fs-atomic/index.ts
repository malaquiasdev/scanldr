// Shared atomic-write helper: write to a `.tmp` path, rename into place, and
// best-effort unlink the `.tmp` file if the write or rename fails. Rename is
// what actually provides atomicity here (same-filesystem rename is atomic),
// so this stays on node:fs/promises rather than Bun.write, which has no
// rename primitive and no `mode` option.

import { rename, unlink, writeFile } from "node:fs/promises";
import type { AtomicWriteOptions } from "./types.ts";

export type { AtomicWriteOptions } from "./types.ts";

/**
 * Atomically write `data` to `path`.
 *
 * Writes to `<path><tmpSuffix>` first (default `.tmp`), then renames it onto
 * `path`. If either step throws, the tmp file is unlinked (best-effort) and
 * the original error is rethrown.
 */
export async function atomicWrite(
  path: string,
  data: string | NodeJS.ArrayBufferView,
  opts: AtomicWriteOptions = {},
): Promise<void> {
  const tmpPath = `${path}${opts.tmpSuffix ?? ".tmp"}`;

  try {
    if (opts.encoding !== undefined) {
      await writeFile(tmpPath, data, { encoding: opts.encoding, mode: opts.mode });
    } else {
      await writeFile(tmpPath, data, { mode: opts.mode });
    }
    await rename(tmpPath, path);
  } catch (err) {
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}
