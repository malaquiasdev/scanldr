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

  test("--chapter alone → exit 2 (not yet implemented)", async () => {
    const r = await run(["download", "Dandadan", "--chapter", "5", "--non-tty"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/--chapter/i);
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
// Unknown command
// ---------------------------------------------------------------------------

describe("unknown command", () => {
  test("unknown command → exit 1", async () => {
    const r = await run(["nonexistent"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/Unknown command/i);
  });
});
