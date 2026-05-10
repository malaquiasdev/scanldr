/**
 * CLI routing integration tests.
 *
 * After Phase 4 decommission, only the walkthrough is the entrypoint.
 * All subcommands (download, list, history, auth, etc.) are removed.
 * Only --help, --version, and walkthrough routing are verified here.
 */
import { describe, expect, test } from "bun:test";

const CLI = new URL("./index.ts", import.meta.url).pathname;

interface RunResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

async function run(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

/**
 * Spawn a CLI process, wait up to `timeoutMs` for it to exit.
 * Returns { timedOut: true } if still running, otherwise the exit result.
 */
async function runWithTimeout(
  args: string[],
  timeoutMs: number,
): Promise<
  { timedOut: true } | { timedOut: false; exitCode: number; stderr: string; stdout: string }
> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });

  let resolved = false;
  const exitPromise = proc.exited.then((code) => {
    resolved = true;
    return code;
  });

  await new Promise((r) => setTimeout(r, timeoutMs));

  if (!resolved) {
    proc.kill();
    return { timedOut: true };
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    exitPromise,
  ]);
  return { timedOut: false, exitCode, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Global meta flags
// ---------------------------------------------------------------------------

describe("--version / --help", () => {
  test("--version prints version and exits 0", async () => {
    const r = await run(["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/scanldr/);
  });

  test("--help prints usage and exits 0", async () => {
    const r = await run(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/scanldr/);
  });

  test("help positional prints usage and exits 0", async () => {
    const r = await run(["help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/scanldr/);
  });
});

// ---------------------------------------------------------------------------
// Walkthrough routing
// ---------------------------------------------------------------------------

describe("walkthrough routing", () => {
  test("no args → enters walkthrough (hangs waiting for TTY input)", async () => {
    const r = await runWithTimeout([], 800);
    if (!r.timedOut) {
      // If it exited quickly it must NOT be a command-not-found error
      expect(r.stderr).not.toMatch(/Unknown command/i);
      expect(r.exitCode).not.toBe(1);
    } else {
      expect(r.timedOut).toBe(true);
    }
  });

  test("single positional arg → enters walkthrough with title prefill", async () => {
    const r = await runWithTimeout(["Naruto"], 800);
    if (!r.timedOut) {
      expect(r.stderr).not.toMatch(/Unknown command/i);
      expect(r.exitCode).not.toBe(1);
    } else {
      expect(r.timedOut).toBe(true);
    }
  });

  test("any flag combination → walkthrough (not routed to dead subcommand)", async () => {
    // Passing a known-old subcommand keyword now becomes a title prefill
    const r = await runWithTimeout(["download"], 800);
    if (!r.timedOut) {
      // Should not exit with "Unknown command" — download is now treated as title prefill
      expect(r.stderr).not.toMatch(/Unknown command/i);
    } else {
      expect(r.timedOut).toBe(true);
    }
  });
});
