#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { CloudflareError, MissingAuthError } from "@integrations/fallback-http/index.ts";
import { AuthError } from "@integrations/mangakakalot/auth/index.ts";
import { MangakakalotParseError } from "@integrations/mangakakalot/client/index.ts";
import { loadConfig } from "@plugins/config/index.ts";
import { openDb, runMigrations } from "@plugins/db/index.ts";
import { CliError } from "@plugins/errors/index.ts";
import { createLogger, type LogFormat, type LogLevel } from "@plugins/logger/index.ts";
import { createTraceStore } from "@plugins/trace/index.ts";
import { runWalkthrough } from "./walkthrough/index.ts";

const VERSION = "0.0.0";

const USAGE = `scanldr — offline downloader for manga, HQ, manhwa, and webtoon

Usage:
  bun start                  Interactive walkthrough

Flags:
  --help, -h      Show this help
  --version, -v   Show version
  --json          Structured JSON log output
  --human         Human-readable log output (default)
  --quiet, -q     Suppress info logs
  --progress      Force the stderr progress bar even when not a TTY
`;

/** Resolves whether the stderr progress bar should be shown. */
export function resolveProgressEnabled(values: {
  progress?: unknown;
  json?: unknown;
  isTTY?: boolean;
}): boolean {
  const forced = values.progress === true;
  const json = values.json === true;
  const isTTY = values.isTTY === true;
  if (json) return false;
  return forced || isTTY;
}

export function resolveLogConfig(values: {
  verbose?: unknown;
  quiet?: unknown;
  json?: unknown;
  human?: unknown;
}): { level: LogLevel; format: LogFormat } {
  const verbose = values.verbose === true;
  const quiet = values.quiet === true;
  const human = values.human === true;
  const json = values.json === true;

  if (verbose && quiet) {
    throw new CliError("--verbose and --quiet are mutually exclusive", 2);
  }
  if (human && json) {
    throw new CliError("--human and --json are mutually exclusive", 2);
  }

  const level: LogLevel = quiet ? "warn" : "info";
  const format: LogFormat = json ? "json" : "human";
  return { level, format };
}

export interface MainDeps {
  loadConfigFn?: typeof loadConfig;
  runWalkthroughFn?: typeof runWalkthrough;
}

export async function main(argv: string[], deps: MainDeps = {}): Promise<void> {
  const { loadConfigFn = loadConfig, runWalkthroughFn = runWalkthrough } = deps;

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      verbose: { type: "boolean" },
      quiet: { type: "boolean", short: "q" },
      json: { type: "boolean" },
      human: { type: "boolean" },
      progress: { type: "boolean" },
    },
  });

  if (values.version) {
    process.stdout.write(`scanldr ${VERSION}\n`);
    return;
  }

  if (values.help || positionals[0] === "help") {
    process.stdout.write(USAGE);
    return;
  }

  const { level, format } = resolveLogConfig(values);
  const progressEnabled = resolveProgressEnabled({
    progress: values.progress,
    json: values.json,
    isTTY: process.stderr.isTTY,
  });

  const { config } = await loadConfigFn();
  const db = openDb(config.db_path);
  runMigrations(db);

  const traceStore = createTraceStore({ db });
  const logger = createLogger({ level, format }, traceStore);

  const result = await runWalkthroughFn({
    logger,
    outDir: config.default_out,
    config,
    progressEnabled,
  });
  if (typeof result === "object" && "cancelled" in result && result.cancelled) {
    process.exit(130);
  }
}

export function formatCliError(err: unknown): { message: string; exitCode: number } {
  if (err instanceof CliError) {
    return { message: err.message, exitCode: err.exitCode };
  }
  if (err instanceof AuthError) {
    return { message: err.message, exitCode: 1 };
  }
  if (err instanceof MissingAuthError) {
    return { message: err.message, exitCode: 1 };
  }
  if (err instanceof CloudflareError) {
    return { message: err.message, exitCode: 1 };
  }
  if (err instanceof MangakakalotParseError) {
    const message = [
      "mangakakalot is serving an unexpected page layout for this series.",
      "This usually means the site changed how chapter lists are loaded, or the series has been removed.",
      "Try again later, or report at https://github.com/malaquiasdev/scanldr/issues",
      `(technical: parse failed at "${err.selector}")`,
    ].join("\n");
    return { message, exitCode: 1 };
  }
  return {
    message: err instanceof Error ? err.message : String(err),
    exitCode: 1,
  };
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (err) {
    const { message, exitCode } = formatCliError(err);
    process.stderr.write(`${message}\n`);
    process.exit(exitCode);
  }
}
