import { describe, expect, test } from "bun:test";
import { resolveLogConfig } from "./index.ts";

describe("resolveLogConfig — flag wiring", () => {
  test("default: info + human", () => {
    expect(resolveLogConfig({})).toEqual({ level: "info", format: "human" });
  });

  test("--verbose keeps info level, format stays human", () => {
    expect(resolveLogConfig({ verbose: true })).toEqual({ level: "info", format: "human" });
  });

  test("--quiet raises threshold to warn, format stays human", () => {
    expect(resolveLogConfig({ quiet: true })).toEqual({ level: "warn", format: "human" });
  });

  test("--json opts into json format", () => {
    expect(resolveLogConfig({ json: true })).toEqual({ level: "info", format: "json" });
  });

  test("--verbose --json combine: info level + json format", () => {
    expect(resolveLogConfig({ verbose: true, json: true })).toEqual({
      level: "info",
      format: "json",
    });
  });

  test("--human is a silent no-op alias (resolves to human)", () => {
    expect(resolveLogConfig({ human: true })).toEqual({ level: "info", format: "human" });
  });

  test("--human + --json throws CLI error (mutually exclusive)", () => {
    expect(() => resolveLogConfig({ human: true, json: true })).toThrow(/mutually exclusive/i);
  });

  test("--verbose + --quiet together throws CLI error (mutual exclusion)", () => {
    expect(() => resolveLogConfig({ verbose: true, quiet: true })).toThrow(/mutually exclusive/i);
  });

  test("--human + --quiet: format and level are orthogonal", () => {
    expect(resolveLogConfig({ human: true, quiet: true })).toEqual({
      level: "warn",
      format: "human",
    });
  });

  test("--human + --verbose: format and level are orthogonal", () => {
    expect(resolveLogConfig({ human: true, verbose: true })).toEqual({
      level: "info",
      format: "human",
    });
  });
});
