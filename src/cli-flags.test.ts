import { describe, expect, test } from "bun:test";
import { parseArgs } from "node:util";
import { normalizePackFlag, resolveLogConfig } from "./index.ts";

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

// ---------------------------------------------------------------------------
// normalizePackFlag — unit tests
// ---------------------------------------------------------------------------

describe("normalizePackFlag — argv pre-processing", () => {
  test("bare --pack at end of argv becomes --pack=", () => {
    expect(normalizePackFlag(["dandadan", "--chapter", "1-3", "--pack"])).toEqual([
      "dandadan",
      "--chapter",
      "1-3",
      "--pack=",
    ]);
  });

  test("--pack followed by another flag becomes --pack=", () => {
    expect(normalizePackFlag(["--pack", "--pack-replace"])).toEqual(["--pack=", "--pack-replace"]);
  });

  test("--pack=my-name passthrough unchanged", () => {
    expect(normalizePackFlag(["--pack=my-name"])).toEqual(["--pack=my-name"]);
  });

  test("--pack name passthrough unchanged (parseArgs consumes next token)", () => {
    expect(normalizePackFlag(["--pack", "my-name"])).toEqual(["--pack", "my-name"]);
  });

  test("argv without --pack is untouched", () => {
    const argv = ["dandadan", "--chapter", "1-3"];
    expect(normalizePackFlag(argv)).toEqual(argv);
  });
});

// ---------------------------------------------------------------------------
// --pack flag parsing — end-to-end parseArgs integration
// ---------------------------------------------------------------------------

const DOWNLOAD_OPTIONS = {
  volume: { type: "string" as const },
  chapter: { type: "string" as const },
  pack: { type: "string" as const },
  "pack-replace": { type: "boolean" as const },
  "pack-overwrite": { type: "boolean" as const },
};

function parseDownloadArgs(argv: string[]) {
  const normalized = normalizePackFlag(argv);
  const { values, positionals } = parseArgs({
    args: normalized,
    allowPositionals: true,
    strict: true,
    options: DOWNLOAD_OPTIONS,
  });
  const rawPack = values.pack;
  const pack: string | boolean | undefined =
    rawPack === "" ? true : typeof rawPack === "string" ? rawPack : undefined;
  return { manga: positionals[0], pack, packReplace: values["pack-replace"] === true };
}

describe("--pack CLI flag wiring", () => {
  test("bare --pack → pack === true", () => {
    const { pack } = parseDownloadArgs(["dandadan", "--chapter", "1-3", "--pack"]);
    expect(pack).toBe(true);
  });

  test("--pack --pack-replace → pack === true, packReplace === true", () => {
    const { pack, packReplace } = parseDownloadArgs([
      "dandadan",
      "--chapter",
      "1-3",
      "--pack",
      "--pack-replace",
    ]);
    expect(pack).toBe(true);
    expect(packReplace).toBe(true);
  });

  test("--pack=my-name → pack === 'my-name'", () => {
    const { pack } = parseDownloadArgs(["dandadan", "--chapter", "1-3", "--pack=my-name"]);
    expect(pack).toBe("my-name");
  });

  test("--pack my-name → pack === 'my-name'", () => {
    const { pack } = parseDownloadArgs(["dandadan", "--chapter", "1-3", "--pack", "my-name"]);
    expect(pack).toBe("my-name");
  });

  test("no --pack flag → pack === undefined", () => {
    const { pack } = parseDownloadArgs(["dandadan", "--chapter", "1-3"]);
    expect(pack).toBeUndefined();
  });
});
