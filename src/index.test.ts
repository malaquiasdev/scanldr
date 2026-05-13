/**
 * Tests for config.default_out → runWalkthrough({ outDir }) wiring.
 * Uses injectable deps to avoid real DB / TTY interaction.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadConfigResult } from "@plugins/config/index.ts";
import { DEFAULT_CONFIG } from "@plugins/config/index.ts";
import { main } from "./index.ts";
import type { RunWalkthroughOptions, WalkthroughFailed } from "./walkthrough/index.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "scanldr-main-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeLoadConfig(
  overrides: Partial<typeof DEFAULT_CONFIG> = {},
): () => Promise<LoadConfigResult> {
  return async () => ({
    config: {
      ...DEFAULT_CONFIG,
      // point db_path at a temp file so openDb doesn't pollute real paths
      db_path: join(workDir, "test.db"),
      ...overrides,
    },
    source: null,
  });
}

// Returns a fake walkthrough that records its options and resolves without calling process.exit.
// We must NOT return { cancelled: true } because main() calls process.exit(130) on that path.
// WalkthroughFailed ({ ok: false, reason }) is safe — main() does not exit on that path.
function makeSpyWalkthrough(spy: {
  calledWith: RunWalkthroughOptions | null;
}): (opts: RunWalkthroughOptions) => Promise<WalkthroughFailed> {
  return async (opts) => {
    spy.calledWith = opts;
    return { ok: false, reason: "spy" };
  };
}

describe("main() — config.default_out wiring", () => {
  test("forwards config.default_out to runWalkthrough as outDir", async () => {
    const spy = { calledWith: null as RunWalkthroughOptions | null };

    await main([], {
      loadConfigFn: makeLoadConfig({ default_out: "./download" }),
      runWalkthroughFn: makeSpyWalkthrough(spy),
    });

    expect(spy.calledWith?.outDir).toBe("./download");
  });

  test("forwards absolute default_out unchanged", async () => {
    const spy = { calledWith: null as RunWalkthroughOptions | null };
    const absPath = "/tmp/my-manga-downloads";

    await main([], {
      loadConfigFn: makeLoadConfig({ default_out: absPath }),
      runWalkthroughFn: makeSpyWalkthrough(spy),
    });

    expect(spy.calledWith?.outDir).toBe(absPath);
  });

  test("when config has no custom default_out, DEFAULT_CONFIG value is forwarded", async () => {
    // DEFAULT_CONFIG.default_out = "./download" — the walkthrough internal fallback to cwd()
    // is only reached when outDir is undefined; here we verify the call shape.
    const spy = { calledWith: null as RunWalkthroughOptions | null };

    await main([], {
      loadConfigFn: makeLoadConfig(),
      runWalkthroughFn: makeSpyWalkthrough(spy),
    });

    expect(spy.calledWith?.outDir).toBe(DEFAULT_CONFIG.default_out);
  });
});
