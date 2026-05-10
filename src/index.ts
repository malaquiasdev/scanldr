#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { CloudflareError, MissingAuthError } from "@integrations/fallback-http/index.ts";
import { AuthError } from "@integrations/mangakakalot/auth/index.ts";
import { loadConfig } from "@plugins/config/index.ts";
import { openDb, runMigrations } from "@plugins/db/index.ts";
import { CliError } from "@plugins/errors/index.ts";
import { type LogFormat, type LogLevel, createLogger } from "@plugins/logger/index.ts";
import { createTraceStore } from "@plugins/trace/index.ts";
import { runWalkthrough } from "./walkthrough/index.ts";

const VERSION = "0.0.0";

const USAGE = `scanldr — offline downloader for manga, HQ, manhwa, and webtoon

Usage:
  bun start                  Interactive walkthrough
  bun start <title-or-url>   Walkthrough with title pre-filled
  bun start --debug-trace    Export trace store as NDJSON for debug

Flags:
  --help, -h      Show this help
  --version, -v   Show version
  --json          Structured JSON log output
  --human         Human-readable log output (default)
  --quiet, -q     Suppress info logs
`;

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

export async function main(argv: string[]): Promise<void> {
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

  const { config } = await loadConfig();
  const db = openDb(config.db_path);
  runMigrations(db);

  const traceStore = createTraceStore({ db });
  const logger = createLogger({ level, format }, traceStore);

  // The first positional (if any) becomes the title prefill for the walkthrough.
  const titlePrefill = positionals[0];

  const result = await runWalkthrough({ logger, titlePrefill });
  if (typeof result === "object" && "cancelled" in result && result.cancelled) {
    process.exit(130);
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(err.exitCode);
    }
    if (err instanceof AuthError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    if (err instanceof MissingAuthError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    if (err instanceof CloudflareError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
