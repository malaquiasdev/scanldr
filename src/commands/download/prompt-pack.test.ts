import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Logger } from "@plugins/logger/index.ts";

const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

// Capture stderr output for assertions
let stderrOutput: string[] = [];
let originalStderrWrite: typeof process.stderr.write;

function captureStderr() {
  stderrOutput = [];
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array, ..._args: unknown[]) => {
    stderrOutput.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };
}

function restoreStderr() {
  process.stderr.write = originalStderrWrite;
}

const baseOpts = {
  slug: "dandadan",
  outputName: "dandadan-volume-103-111.cbz",
  defaultVolumeStem: "103-111",
  checkExists: async () => false,
  nonTty: false,
  packFlag: false,
  packNameProvided: false,
  packReplace: false,
  packOverwrite: false,
  chapterCount: 9,
  logger: noopLogger,
};

// ---------------------------------------------------------------------------
// Prompt visibility — prompts always written to stderr before readline reads
// ---------------------------------------------------------------------------

describe("runPackPrompts — prompt text written to stderr before readline", () => {
  beforeEach(captureStderr);
  afterEach(() => {
    restoreStderr();
    mock.restore();
  });

  test("Pack N chapters prompt appears on stderr before answer is read", async () => {
    let stderrAtCallTime: string[] = [];

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          // Capture what's been written to stderr so far, then answer
          stderrAtCallTime = [...stderrOutput];
          cb("n");
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    await runPackPrompts({ ...baseOpts });

    // The pack prompt text must have been written to stderr before readline fired
    expect(stderrAtCallTime.join("")).toMatch(/Pack 9 chapters/);
  });

  test("Delete individual files prompt appears on stderr before answer is read", async () => {
    let stderrWhenDeletePrompted: string[] = [];
    let callCount = 0;

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          if (callCount === 1) {
            // First call: "Pack?" → yes
            cb("y");
          } else if (callCount === 2) {
            // Second call: "Volume number?" → blank
            cb("");
          } else if (callCount === 3) {
            // Third call: "Cover URL?" → blank (skip cover)
            cb("");
          } else {
            // Fourth call: "Delete?" → capture then answer
            stderrWhenDeletePrompted = [...stderrOutput];
            cb("n");
          }
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    await runPackPrompts({ ...baseOpts });

    expect(stderrWhenDeletePrompted.join("")).toMatch(/Delete individual chapter files/);
  });

  test("Volume number prompt appears on stderr before answer is read", async () => {
    let stderrWhenVolumePrompted: string[] = [];
    let callCount = 0;

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          if (callCount === 1) {
            // "Pack?" → yes
            cb("y");
          } else if (callCount === 2) {
            // "Volume number?" → capture stderr first then answer
            stderrWhenVolumePrompted = [...stderrOutput];
            cb("");
          } else if (callCount === 3) {
            // "Cover URL?" → blank
            cb("");
          } else {
            cb("n");
          }
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    await runPackPrompts({ ...baseOpts });

    expect(stderrWhenVolumePrompted.join("")).toMatch(/Volume number/);
    expect(stderrWhenVolumePrompted.join("")).toMatch(/103-111/);
  });
});

// ---------------------------------------------------------------------------
// Volume-number prompt — happy paths
// ---------------------------------------------------------------------------

describe("runPackPrompts — volume-number prompt", () => {
  afterEach(() => mock.restore());

  test("AC5: user accepts pack and is prompted for volume number in interactive TTY mode", async () => {
    let volumePromptShown = false;
    let callCount = 0;

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          if (callCount === 1) cb("y");        // Pack?
          else if (callCount === 2) {
            volumePromptShown = true;
            cb("");                             // Volume number (blank)
          } else if (callCount === 3) cb("");   // Cover URL? (blank)
          else cb("n");                         // Delete?
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({ ...baseOpts });

    expect(result.shouldPack).toBe(true);
    expect(volumePromptShown).toBe(true);
  });

  test("AC6: blank volume input → volumeName is undefined (default)", async () => {
    let callCount = 0;

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          if (callCount === 1) cb("y");
          else if (callCount === 2) cb("");     // volume number blank
          else if (callCount === 3) cb("");     // cover URL blank
          else cb("n");
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({ ...baseOpts });

    expect(result.volumeName).toBeUndefined();
  });

  test("AC7: non-empty input → volumeName equals input", async () => {
    let callCount = 0;

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          if (callCount === 1) cb("y");
          else if (callCount === 2) cb("13");  // volume number
          else if (callCount === 3) cb("");    // cover URL blank
          else cb("n");
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({ ...baseOpts });

    expect(result.volumeName).toBe("13");
  });

  test("AC8: accepts alphanumeric, dash, underscore, dot, spaces (e.g. 13-final)", async () => {
    let callCount = 0;

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          if (callCount === 1) cb("y");
          else if (callCount === 2) cb("13-final special_1.0");
          else if (callCount === 3) cb("");    // cover URL blank
          else cb("n");
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({ ...baseOpts });

    expect(result.volumeName).toBe("13-final special_1.0");
  });

  test("AC9: rejects slash, re-prompts, then accepts valid input on second try", async () => {
    let callCount = 0;
    let stderrBuf = "";
    captureStderr();

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          if (callCount === 1) cb("y");
          else if (callCount === 2) cb("../../evil");  // invalid
          else if (callCount === 3) cb("13");          // valid on retry
          else if (callCount === 4) cb("");            // cover URL blank
          else cb("n");
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({ ...baseOpts });
    stderrBuf = stderrOutput.join("");
    restoreStderr();

    expect(result.volumeName).toBe("13");
    expect(stderrBuf).toMatch(/Invalid volume name/);
  });
});

// ---------------------------------------------------------------------------
// Volume-number prompt — skip conditions (AC10)
// ---------------------------------------------------------------------------

describe("runPackPrompts — volume-number prompt is skipped when", () => {
  afterEach(() => mock.restore());

  test("AC10a: --pack <name> was passed (packNameProvided=true)", async () => {
    let callCount = 0;
    const callArgs: number[] = [];

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          callArgs.push(callCount);
          if (callCount === 1) cb("y");   // Pack?
          else cb("n");                   // Delete? (no volume number prompt in between)
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({
      ...baseOpts,
      packNameProvided: true,
      packFlag: true,
    });

    // packFlag=true means pack is decided via flag (no pack prompt), only delete prompt fires
    expect(callCount).toBe(1);
    expect(result.volumeName).toBeUndefined();
  });

  test("AC10b: --pack-replace was passed (non-interactive delete path)", async () => {
    // packReplace means shouldDelete=true without prompt, and no volume-number prompt
    let callCount = 0;

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          cb("y"); // only "Pack?" prompt
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({
      ...baseOpts,
      packFlag: true,
      packReplace: true,
    });

    // pack is set via flag, so no pack prompt is shown; packReplace skips volume prompt
    expect(callCount).toBe(0);
    expect(result.shouldPack).toBe(true);
    expect(result.shouldDelete).toBe(true);
    expect(result.volumeName).toBeUndefined();
  });

  test("AC10c: non-TTY mode (nonTty=true) with packFlag", async () => {
    let callCount = 0;

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          cb("y");
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({
      ...baseOpts,
      nonTty: true,
      packFlag: true,
    });

    expect(callCount).toBe(0);
    expect(result.volumeName).toBeUndefined();
  });

  test("AC10d: N == 1 → whole pack flow skipped (no prompts at all)", async () => {
    let callCount = 0;

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          cb("y");
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({ ...baseOpts, chapterCount: 1 });

    expect(callCount).toBe(0);
    expect(result.shouldPack).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P0 regression: existence check must happen AFTER effective name is resolved
// ---------------------------------------------------------------------------

describe("runPackPrompts — overwrite check against effective (post-prompt) filename", () => {
  afterEach(() => {
    restoreStderr();
    mock.restore();
  });

  test("prompts overwrite when custom volume name collides even if default name does not exist", async () => {
    // dandadan-volume-13.cbz exists, dandadan-volume-103-111.cbz does not
    let overwritePromptShown = false;
    let callCount = 0;

    captureStderr();

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          if (callCount === 1) cb("y");   // Pack?
          else if (callCount === 2) cb("13"); // Volume number → collides
          else if (callCount === 3) cb(""); // Cover URL? → blank
          else if (callCount === 4) {
            overwritePromptShown = true;
            cb("y"); // Overwrite?
          } else cb("n"); // Delete?
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({
      ...baseOpts,
      // Default name does NOT exist; only "dandadan-volume-13.cbz" exists
      checkExists: async (filename: string) => filename === "dandadan-volume-13.cbz",
    });

    expect(overwritePromptShown).toBe(true);
    expect(result.shouldPack).toBe(true);
    expect(result.volumeName).toBe("13");
  });

  test("does not prompt overwrite when neither default nor custom name exists", async () => {
    let overwritePromptShown = false;
    let callCount = 0;

    captureStderr();

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          if (callCount === 1) cb("y");   // Pack?
          else if (callCount === 2) cb("13"); // Volume number
          else if (callCount === 3) cb(""); // Cover URL? → blank
          else if (callCount === 4) {
            // Should be Delete? not Overwrite?
            overwritePromptShown = stderrOutput.join("").includes("Overwrite");
            cb("n"); // Delete?
          }
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({
      ...baseOpts,
      checkExists: async () => false, // nothing exists
    });

    expect(overwritePromptShown).toBe(false);
    expect(result.shouldPack).toBe(true);
    expect(result.volumeName).toBe("13");
  });
});

// ---------------------------------------------------------------------------
// --cover-url flag path (non-interactive, non-TTY)
// ---------------------------------------------------------------------------

describe("runPackPrompts — --cover-url flag path", () => {
  afterEach(() => {
    restoreStderr();
    mock.restore();
  });

  test("--cover-url with valid URL fetches cover and includes in result", async () => {
    captureStderr();
    const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

    mock.module("./cover.ts", () => ({
      fetchCover: async (_url: string) => ({ bytes: JPEG_BYTES, ext: ".jpg" }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({
      ...baseOpts,
      nonTty: true,
      packFlag: true,
      coverUrl: "https://example.com/cover.jpg",
    });

    expect(result.cover).toBeDefined();
    expect(result.cover?.ext).toBe(".jpg");
    expect(result.cover?.bytes).toEqual(JPEG_BYTES);
  });

  test("--cover-url with invalid scheme fails fast (no re-prompt)", async () => {
    captureStderr();

    mock.module("./cover.ts", () => ({
      fetchCover: async (_url: string) => {
        throw new Error("Only http(s) URLs allowed");
      },
    }));

    // Track if any readline prompt fires — it must not
    let promptFired = false;
    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, _cb: (line: string) => void) => {
          promptFired = true;
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    // Flag path warns and continues without cover — does NOT re-prompt
    const result = await runPackPrompts({
      ...baseOpts,
      nonTty: true,
      packFlag: true,
      coverUrl: "file:///etc/passwd",
    });

    expect(promptFired).toBe(false);
    expect(result.cover).toBeUndefined();
  });

  test("--cover-url with HTTP 404 fails fast (no re-prompt)", async () => {
    captureStderr();

    mock.module("./cover.ts", () => ({
      fetchCover: async (_url: string) => {
        throw new Error("Cover fetch failed: HTTP 404");
      },
    }));

    let promptFired = false;
    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, _cb: (line: string) => void) => {
          promptFired = true;
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({
      ...baseOpts,
      nonTty: true,
      packFlag: true,
      coverUrl: "https://example.com/missing.jpg",
    });

    expect(promptFired).toBe(false);
    expect(result.cover).toBeUndefined();
  });

  test("--cover-url empty string skips cover (matches empty prompt behavior)", async () => {
    captureStderr();
    let fetchCalled = false;

    mock.module("./cover.ts", () => ({
      fetchCover: async (_url: string) => {
        fetchCalled = true;
        return { bytes: new Uint8Array([0xff, 0xd8]), ext: ".jpg" };
      },
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({
      ...baseOpts,
      nonTty: true,
      packFlag: true,
      coverUrl: "",
    });

    expect(fetchCalled).toBe(false);
    expect(result.cover).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Issue #79 regression: effectiveOutputName uses <slug>-volume-<input> convention
// ---------------------------------------------------------------------------

describe("runPackPrompts — effectiveOutputName uses slug-volume convention (issue #79)", () => {
  afterEach(() => {
    restoreStderr();
    mock.restore();
  });

  test("prompt input '13' → checkExists called with 'dandadan-volume-13.cbz'", async () => {
    const checkedNames: string[] = [];
    let callCount = 0;

    captureStderr();

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          if (callCount === 1) cb("y");      // Pack?
          else if (callCount === 2) cb("13"); // Volume number
          else if (callCount === 3) cb("");   // Cover URL? → blank
          else cb("n");                       // Delete?
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    await runPackPrompts({
      ...baseOpts,
      checkExists: async (filename: string) => {
        checkedNames.push(filename);
        return false;
      },
    });

    expect(checkedNames).toContain("dandadan-volume-13.cbz");
    expect(checkedNames).not.toContain("13.cbz");
  });

  test("prompt input empty preserves default <slug>-volume-<first>-<last>.cbz", async () => {
    const checkedNames: string[] = [];
    let callCount = 0;

    captureStderr();

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          callCount++;
          if (callCount === 1) cb("y");   // Pack?
          else if (callCount === 2) cb(""); // blank → default
          else if (callCount === 3) cb(""); // Cover URL? → blank
          else cb("n");                     // Delete?
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({
      ...baseOpts,
      checkExists: async (filename: string) => {
        checkedNames.push(filename);
        return false;
      },
    });

    expect(result.volumeName).toBeUndefined();
    expect(checkedNames).toContain("dandadan-volume-103-111.cbz");
  });

  test("--pack <name> flag treats input as full filename without volume prefix (regression)", async () => {
    // When --pack <name> is provided, packNameProvided=true skips the volume prompt entirely.
    // pack-flow.ts passes customName directly to packVolume → no slug-volume- prefix added.
    // This test verifies the prompt layer does not interfere with the flag path.
    captureStderr();

    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => {
          // Only the delete prompt should fire (pack decided via flag, no volume prompt)
          cb("n");
        },
        close: () => {},
      }),
    }));

    const { runPackPrompts } = await import("./prompt-pack.ts");
    const result = await runPackPrompts({
      ...baseOpts,
      packFlag: true,
      packNameProvided: true,
      // outputName already reflects the --pack <name> resolved filename
      outputName: "box-set-final.cbz",
    });

    // Volume prompt skipped → volumeName stays undefined → pack-flow.ts uses customName as-is
    expect(result.volumeName).toBeUndefined();
    expect(result.shouldPack).toBe(true);
  });
});
