import { describe, expect, test } from "bun:test";
import { resolveLogConfig } from "./index.ts";

describe("resolveLogConfig — flag wiring", () => {
  test("default: info + human", () => {
    expect(resolveLogConfig({})).toEqual({ level: "info", format: "human" });
  });

  test("--verbose keeps info level", () => {
    expect(resolveLogConfig({ verbose: true })).toEqual({ level: "info", format: "human" });
  });

  test("--quiet raises threshold to warn", () => {
    expect(resolveLogConfig({ quiet: true })).toEqual({ level: "warn", format: "human" });
  });

  test("--json switches format", () => {
    expect(resolveLogConfig({ json: true })).toEqual({ level: "info", format: "json" });
  });

  test("--verbose --json combine", () => {
    expect(resolveLogConfig({ verbose: true, json: true })).toEqual({
      level: "info",
      format: "json",
    });
  });

  test("--verbose + --quiet together throws CLI error (mutual exclusion)", () => {
    expect(() => resolveLogConfig({ verbose: true, quiet: true })).toThrow(/mutually exclusive/i);
  });
});
