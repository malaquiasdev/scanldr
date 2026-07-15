import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig, validateAndMerge } from "@plugins/config/index.ts";
import { ConfigError } from "@plugins/errors/index.ts";

let workDir: string;
let homeDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "scanldr-cwd-"));
  homeDir = await mkdtemp(join(tmpdir(), "scanldr-home-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});

describe("loadConfig — discovery", () => {
  test("returns defaults when no config file is found", async () => {
    const result = await loadConfig({
      env: {},
      cwd: workDir,
      home: homeDir,
    });

    expect(result.source).toBeNull();
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  test("loads a full config from ./scanldr.json", async () => {
    const cfgPath = join(workDir, "scanldr.json");
    await writeFile(
      cfgPath,
      JSON.stringify({
        default_format: "zip",
        default_out: "./out",
        image_concurrency: 8,
        chapter_delay_ms: 250,
      }),
    );

    const result = await loadConfig({ env: {}, cwd: workDir, home: homeDir });

    expect(result.source).toBe(cfgPath);
    expect(result.config).toEqual({
      default_format: "zip",
      default_out: "./out",
      db_path: DEFAULT_CONFIG.db_path,
      image_concurrency: 8,
      chapter_delay_ms: 250,
    });
  });

  test("partial config merges over defaults", async () => {
    const cfgPath = join(workDir, "scanldr.json");
    await writeFile(cfgPath, JSON.stringify({ image_concurrency: 2, default_format: "zip" }));

    const result = await loadConfig({ env: {}, cwd: workDir, home: homeDir });

    expect(result.config).toEqual({
      ...DEFAULT_CONFIG,
      image_concurrency: 2,
      default_format: "zip",
    });
  });

  test("falls back to XDG path when no ./scanldr.json exists", async () => {
    const xdgDir = join(homeDir, ".config", "scanldr");
    await mkdir(xdgDir, { recursive: true });
    const xdgPath = join(xdgDir, "scanldr.json");
    await writeFile(xdgPath, JSON.stringify({ default_out: "/tmp/from-xdg" }));

    const result = await loadConfig({ env: {}, cwd: workDir, home: homeDir });

    expect(result.source).toBe(xdgPath);
    expect(result.config.default_out).toBe("/tmp/from-xdg");
  });

  test("respects $XDG_CONFIG_HOME when set", async () => {
    const xdgRoot = await mkdtemp(join(tmpdir(), "scanldr-xdg-"));
    try {
      const xdgDir = join(xdgRoot, "scanldr");
      await mkdir(xdgDir, { recursive: true });
      const xdgPath = join(xdgDir, "scanldr.json");
      await writeFile(xdgPath, JSON.stringify({ chapter_delay_ms: 0 }));

      const result = await loadConfig({
        env: { XDG_CONFIG_HOME: xdgRoot },
        cwd: workDir,
        home: homeDir,
      });

      expect(result.source).toBe(xdgPath);
      expect(result.config.chapter_delay_ms).toBe(0);
    } finally {
      await rm(xdgRoot, { recursive: true, force: true });
    }
  });

  test("$SCANLDR_CONFIG overrides cwd and XDG paths", async () => {
    // Ambient ./scanldr.json that should be ignored.
    await writeFile(
      join(workDir, "scanldr.json"),
      JSON.stringify({ default_out: "./should-be-ignored" }),
    );

    const envCfg = join(workDir, "custom.json");
    await writeFile(envCfg, JSON.stringify({ default_out: "./from-env" }));

    const result = await loadConfig({
      env: { SCANLDR_CONFIG: envCfg },
      cwd: workDir,
      home: homeDir,
    });

    expect(result.source).toBe(envCfg);
    expect(result.config.default_out).toBe("./from-env");
  });

  test("$SCANLDR_CONFIG missing file throws", async () => {
    const ghost = join(workDir, "ghost.json");
    await expect(
      loadConfig({
        env: { SCANLDR_CONFIG: ghost },
        cwd: workDir,
        home: homeDir,
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  test("--config flag overrides env and ambient paths", async () => {
    await writeFile(join(workDir, "scanldr.json"), JSON.stringify({ default_out: "./from-cwd" }));

    const envCfg = join(workDir, "env.json");
    await writeFile(envCfg, JSON.stringify({ default_out: "./from-env" }));

    const flagCfg = join(workDir, "flag.json");
    await writeFile(flagCfg, JSON.stringify({ default_out: "./from-flag" }));

    const result = await loadConfig({
      configPath: flagCfg,
      env: { SCANLDR_CONFIG: envCfg },
      cwd: workDir,
      home: homeDir,
    });

    expect(result.source).toBe(flagCfg);
    expect(result.config.default_out).toBe("./from-flag");
  });

  test("--config flag pointing to missing file throws", async () => {
    await expect(
      loadConfig({
        configPath: join(workDir, "nope.json"),
        env: {},
        cwd: workDir,
        home: homeDir,
      }),
    ).rejects.toThrow(/--config path does not exist/);
  });

  test("loads a legacy config with removed keys (preferred_languages, download_quality) without erroring", async () => {
    const cfgPath = join(workDir, "scanldr.json");
    await writeFile(
      cfgPath,
      JSON.stringify({
        default_format: "zip",
        image_concurrency: 2,
        preferred_languages: ["en", "pt-BR"],
        download_quality: "high",
      }),
    );

    const result = await loadConfig({ env: {}, cwd: workDir, home: homeDir });

    expect(result.source).toBe(cfgPath);
    expect(result.config).toEqual({
      ...DEFAULT_CONFIG,
      default_format: "zip",
      image_concurrency: 2,
    });
    expect(result.config).not.toHaveProperty("preferred_languages");
    expect(result.config).not.toHaveProperty("download_quality");
  });
});

describe("loadConfig — parsing errors", () => {
  test("malformed JSON throws ConfigError naming the file", async () => {
    const cfgPath = join(workDir, "scanldr.json");
    await writeFile(cfgPath, "{ not valid json");

    let caught: unknown;
    try {
      await loadConfig({ env: {}, cwd: workDir, home: homeDir });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    const ce = caught as ConfigError;
    expect(ce.path).toBe(cfgPath);
    expect(ce.message).toContain(cfgPath);
    expect(ce.message).toContain("failed to parse");
  });

  test("non-object root throws ConfigError", async () => {
    const cfgPath = join(workDir, "scanldr.json");
    await writeFile(cfgPath, "[1, 2, 3]");

    await expect(loadConfig({ env: {}, cwd: workDir, home: homeDir })).rejects.toThrow(
      /config root must be a JSON object/,
    );
  });
});

describe("validateAndMerge — field validations", () => {
  test("rejects negative image_concurrency", () => {
    expect(() => validateAndMerge({ image_concurrency: -1 })).toThrow(/image_concurrency.*>= 1/);
  });

  test("rejects zero image_concurrency", () => {
    expect(() => validateAndMerge({ image_concurrency: 0 })).toThrow(/image_concurrency/);
  });

  test("rejects non-integer image_concurrency", () => {
    expect(() => validateAndMerge({ image_concurrency: 1.5 })).toThrow(/image_concurrency/);
  });

  test("rejects negative chapter_delay_ms", () => {
    expect(() => validateAndMerge({ chapter_delay_ms: -5 })).toThrow(/chapter_delay_ms/);
  });

  test("accepts zero chapter_delay_ms", () => {
    const cfg = validateAndMerge({ chapter_delay_ms: 0 });
    expect(cfg.chapter_delay_ms).toBe(0);
  });

  test("rejects unknown default_format", () => {
    expect(() => validateAndMerge({ default_format: "rar" })).toThrow(/default_format/);
  });

  test("rejects empty default_out", () => {
    expect(() => validateAndMerge({ default_out: "" })).toThrow(/default_out/);
  });

  test("does not mutate DEFAULT_CONFIG when merging", () => {
    const before = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    validateAndMerge({ image_concurrency: 16, default_format: "zip" });
    expect(DEFAULT_CONFIG).toEqual(before);
  });
});
