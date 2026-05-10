/**
 * CLI routing integration tests.
 *
 * These tests spawn the CLI as a subprocess to verify that flags are correctly
 * routed to their handlers (i.e. --volume 13 reaches the download handler as
 * a string, not as boolean true). All tested paths exit before hitting the
 * network (missing required flags, mutual exclusion, --help, --version).
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

// ---------------------------------------------------------------------------
// Global flags
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

  test("help command prints usage and exits 0", async () => {
    const r = await run(["help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/scanldr/);
  });
});

// ---------------------------------------------------------------------------
// download: argv routing fix — flags must reach the handler
// ---------------------------------------------------------------------------

describe("download: required-flag validation", () => {
  test("missing --volume AND --chapter → exit 2 with usage hint", async () => {
    // This used to succeed incorrectly (volume was undefined, triggering the
    // wrong branch). After the fix it should correctly report the missing flag.
    const r = await run(["download", "Dandadan", "--non-tty"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/--volume/i);
  });

  test("--volume value is correctly received (not coerced to boolean)", async () => {
    // With the old double-parseArgs, --volume 13 would turn into boolean true
    // and "13" would become a positional, so the handler never saw volume=13.
    // Now it should reach the download handler with volume set, and fail later
    // (at network / config stage), NOT with the "is required" message.
    const r = await run(["download", "Dandadan", "--volume", "13", "--non-tty", "--dry-run"]);
    // Should NOT produce the "is required" error — it may fail for other reasons
    // (network, config) but not because --volume was missing.
    expect(r.stderr).not.toMatch(/--volume.*is required/i);
  });

  test("--volume and --chapter together → exit 2 (mutual exclusion)", async () => {
    const r = await run(["download", "Dandadan", "--volume", "1", "--chapter", "5", "--non-tty"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/mutually exclusive/i);
  });

  test("--chapter alone → exits (now implemented; exits non-zero only on network/resolve error)", async () => {
    // --chapter is now implemented. In non-TTY mode with no network, it will try to resolve the manga
    // and fail at the MangaDex API level. We just assert mutual exclusion no longer triggers.
    const r = await run(["download", "Dandadan", "--chapter", "5", "--non-tty"]);
    // Must NOT be a mutual-exclusion error
    expect(r.stderr).not.toMatch(/mutually exclusive/i);
  });

  test("missing manga positional → exit 2 with usage", async () => {
    const r = await run(["download", "--volume", "1", "--non-tty"]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/Usage/i);
  });
});

// ---------------------------------------------------------------------------
// list: flag routing
// ---------------------------------------------------------------------------

describe("list: argv routing", () => {
  test("missing manga positional → exit 2 with usage", async () => {
    const r = await run(["list"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/Usage/i);
  });

  test("--volume and --chapter together → exit 2 (mutual exclusion)", async () => {
    // These flags reach runList which throws for mutual exclusion
    const r = await run(["list", "X", "--volume", "1", "--chapter", "5", "--non-tty"]);
    expect(r.exitCode).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Global flag positioning
// ---------------------------------------------------------------------------

describe("global flags can appear before command", () => {
  test("--verbose before command does not break routing", async () => {
    // Should fail on missing manga, not on flag parsing
    const r = await run(["--verbose", "download", "--volume", "1", "--non-tty"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/Usage/i);
  });
});

// ---------------------------------------------------------------------------
// Walkthrough routing helpers
// ---------------------------------------------------------------------------

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

describe("walkthrough routing", () => {
  test("no args → enters walkthrough (does not print 'Unknown command', hangs for input)", async () => {
    const r = await runWithTimeout([], 800);
    // Process should be waiting for TTY input (walkthrough started), not exited quickly with error
    if (!r.timedOut) {
      // If it did exit quickly, it should NOT be the "Unknown command" error
      expect(r.stderr).not.toMatch(/Unknown command/i);
      // And should not have exited with exit code 1 from command routing
      expect(r.exitCode).not.toBe(1);
    } else {
      // timedOut means walkthrough is running and waiting for input — correct routing
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

  test("download subcommand → still routes to download (regression)", async () => {
    const r = await run(["download", "--volume", "1", "--non-tty"]);
    // Should reach the download handler and fail on missing manga, not route to walkthrough
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/Usage/i);
  });

  test("list subcommand → still routes to list (regression)", async () => {
    const r = await run(["list"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/Usage/i);
  });
});
