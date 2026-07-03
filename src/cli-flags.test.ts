import { describe, expect, test } from "bun:test";
import { resolveLogConfig, resolveProgressEnabled } from "./index.ts";

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

describe("resolveProgressEnabled — progress bar gating", () => {
  test("non-TTY, no flags: disabled (CI-safe default)", () => {
    expect(resolveProgressEnabled({ isTTY: false })).toBe(false);
  });

  test("TTY, no flags: enabled by default", () => {
    expect(resolveProgressEnabled({ isTTY: true })).toBe(true);
  });

  test("--progress forces enabled even when non-TTY", () => {
    expect(resolveProgressEnabled({ isTTY: false, progress: true })).toBe(true);
  });

  test("--json always suppresses the bar, even on a TTY", () => {
    expect(resolveProgressEnabled({ isTTY: true, json: true })).toBe(false);
  });

  test("--json + --progress: json wins, bar suppressed", () => {
    expect(resolveProgressEnabled({ isTTY: false, json: true, progress: true })).toBe(false);
  });
});
