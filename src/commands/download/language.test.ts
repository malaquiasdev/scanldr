import { describe, expect, mock, test } from "bun:test";
import { CliError } from "@plugins/errors/index.ts";
import type { Logger } from "@plugins/logger/index.ts";
import { resolveLanguage } from "./language.ts";

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("resolveLanguage", () => {
  test("first preferred match wins silently", async () => {
    const result = await resolveLanguage({
      preferred: ["pt-BR", "en"],
      available: ["en", "pt-BR"],
      nonTty: true,
      logger: noopLogger,
    });
    expect(result).toBe("pt-BR");
  });

  test("second preferred match used when first not available", async () => {
    const result = await resolveLanguage({
      preferred: ["ja", "en"],
      available: ["en", "pt-BR"],
      nonTty: true,
      logger: noopLogger,
    });
    expect(result).toBe("en");
  });

  test("no match + nonTty throws CliError", async () => {
    await expect(
      resolveLanguage({
        preferred: ["ja", "zh"],
        available: ["en", "pt-BR"],
        nonTty: true,
        logger: noopLogger,
      }),
    ).rejects.toBeInstanceOf(CliError);
  });

  test("empty available (nonTty=true) throws CliError with helpful message", async () => {
    await expect(
      resolveLanguage({
        preferred: ["en"],
        available: [],
        nonTty: true,
        logger: noopLogger,
      }),
    ).rejects.toMatchObject({
      name: "CliError",
      message: expect.stringContaining("scanldr list"),
    });
  });

  test("empty available (nonTty=false) throws CliError with helpful message", async () => {
    await expect(
      resolveLanguage({
        preferred: ["en"],
        available: [],
        nonTty: false,
        logger: noopLogger,
      }),
    ).rejects.toMatchObject({
      name: "CliError",
      message: expect.stringContaining("scanldr list"),
    });
  });

  test("no match + nonTty error message is actionable", async () => {
    try {
      await resolveLanguage({
        preferred: ["ja"],
        available: ["en"],
        nonTty: true,
        logger: noopLogger,
      });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("preferred_languages");
    }
  });

  test("TTY: user picks valid index → returns matching language", async () => {
    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (event: string, cb: (line: string) => void) => {
          if (event === "line") cb("2");
        },
        close: () => {},
      }),
    }));

    const result = await resolveLanguage({
      preferred: ["ja"],
      available: ["en", "pt-BR"],
      nonTty: false,
      logger: noopLogger,
    });
    expect(result).toBe("pt-BR");
  });

  test("TTY: user enters out-of-range index → throws CliError", async () => {
    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (event: string, cb: (line: string) => void) => {
          if (event === "line") cb("99");
        },
        close: () => {},
      }),
    }));

    await expect(
      resolveLanguage({
        preferred: ["ja"],
        available: ["en", "pt-BR"],
        nonTty: false,
        logger: noopLogger,
      }),
    ).rejects.toBeInstanceOf(CliError);
  });

  test("TTY: user enters non-numeric input → throws CliError", async () => {
    mock.module("node:readline", () => ({
      createInterface: () => ({
        once: (event: string, cb: (line: string) => void) => {
          if (event === "line") cb("abc");
        },
        close: () => {},
      }),
    }));

    await expect(
      resolveLanguage({
        preferred: ["ja"],
        available: ["en", "pt-BR"],
        nonTty: false,
        logger: noopLogger,
      }),
    ).rejects.toBeInstanceOf(CliError);
  });
});
