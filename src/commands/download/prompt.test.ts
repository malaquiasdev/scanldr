import { afterAll, describe, expect, mock, test } from "bun:test";
import { CliError } from "@plugins/errors/index.ts";
import type { Logger } from "@plugins/logger/index.ts";

const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const items = [{ display: "Alpha" }, { display: "Beta" }, { display: "Gamma" }];

describe("promptNumericChoice", () => {
  afterAll(() => mock.restore());

  test("valid input returns 0-based index", async () => {
    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => cb("2"),
        close: () => {},
      }),
    }));
    const { promptNumericChoice } = await import("./prompt.ts");
    const result = await promptNumericChoice({ header: "Choose:", items, logger: noopLogger });
    expect(result).toBe(1);
  });

  test("out-of-range input throws CliError and fires logger.warn", async () => {
    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => cb("99"),
        close: () => {},
      }),
    }));
    let warnFired = false;
    const spyLogger: Logger = {
      info: () => {},
      warn: () => {
        warnFired = true;
      },
      error: () => {},
    };
    const { promptNumericChoice } = await import("./prompt.ts");
    await expect(
      promptNumericChoice({ header: "Choose:", items, logger: spyLogger }),
    ).rejects.toBeInstanceOf(CliError);
    expect(warnFired).toBe(true);
  });

  test("non-numeric input throws CliError and fires logger.warn", async () => {
    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (_event: string, cb: (line: string) => void) => cb("abc"),
        close: () => {},
      }),
    }));
    let warnFired = false;
    const spyLogger: Logger = {
      info: () => {},
      warn: () => {
        warnFired = true;
      },
      error: () => {},
    };
    const { promptNumericChoice } = await import("./prompt.ts");
    await expect(
      promptNumericChoice({ header: "Choose:", items, logger: spyLogger }),
    ).rejects.toBeInstanceOf(CliError);
    expect(warnFired).toBe(true);
  });
});
