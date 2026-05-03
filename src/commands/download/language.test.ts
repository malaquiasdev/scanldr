import { describe, expect, test } from "bun:test";
import type { Logger } from "@plugins/logger/index.ts";
import { resolveLanguage } from "./language.ts";
import { CliError } from "./range.ts";

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
});
