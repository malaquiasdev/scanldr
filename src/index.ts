#!/usr/bin/env bun
import { parseArgs } from "node:util";
import {
  type LogFormat,
  type LogLevel,
  type Logger,
  createLogger,
} from "./plugins/logger/index.ts";

const VERSION = "0.0.0";

const USAGE = `scanldr — offline downloader for manga, HQ, manhwa, and webtoon

Usage:
  scanldr <command> [args] [flags]

Commands:
  auth                          Open browser for Cloudflare bypass, save session
  list <manga>                  List volumes, chapters, languages, groups
  download <manga> --volume <n> Download volumes (e.g. 1, 1-5, 1,3,7, 1-5,8,10)
  download <manga> --chapter <n> Download chapters (same range syntax)
  update <manga>                Download what is missing in history
  sync                          Run update for every active subscription
  watch <manga>                 Add to subscription list
  unwatch <manga>               Remove from subscription list (history is kept)
  watchlist [--paused]          List subscriptions
  pause <manga>                 Skip a subscription on sync
  resume <manga>                Re-enable a paused subscription
  import <file>                 Bootstrap subscriptions from a flat-text list
  export [--out <file>]         Dump active subscriptions as plain text
  history [--manga <m>]         Display download history
  help                          Show this help
  version                       Show version

Flags: see docs/overviewer.md §4.3 for the full common-flag table.
`;

class NotImplementedError extends Error {
  constructor(command: string) {
    super(`'${command}' is not implemented yet — scaffold only.`);
    this.name = "NotImplementedError";
  }
}

class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 2,
  ) {
    super(message);
    this.name = "CliError";
  }
}

interface HandlerContext {
  logger: Logger;
}

type Handler = (rest: string[], ctx: HandlerContext) => Promise<void> | void;

const handlers: Record<string, Handler> = {
  auth: () => {
    throw new NotImplementedError("auth");
  },
  list: () => {
    throw new NotImplementedError("list");
  },
  download: () => {
    throw new NotImplementedError("download");
  },
  update: () => {
    throw new NotImplementedError("update");
  },
  sync: () => {
    throw new NotImplementedError("sync");
  },
  watch: () => {
    throw new NotImplementedError("watch");
  },
  unwatch: () => {
    throw new NotImplementedError("unwatch");
  },
  watchlist: () => {
    throw new NotImplementedError("watchlist");
  },
  pause: () => {
    throw new NotImplementedError("pause");
  },
  resume: () => {
    throw new NotImplementedError("resume");
  },
  import: () => {
    throw new NotImplementedError("import");
  },
  export: () => {
    throw new NotImplementedError("export");
  },
  history: () => {
    throw new NotImplementedError("history");
  },
};

export function resolveLogConfig(values: {
  verbose?: unknown;
  quiet?: unknown;
  json?: unknown;
}): { level: LogLevel; format: LogFormat } {
  const verbose = values.verbose === true;
  const quiet = values.quiet === true;
  const json = values.json === true;

  if (verbose && quiet) {
    throw new CliError("--verbose and --quiet are mutually exclusive", 2);
  }

  const level: LogLevel = verbose ? "debug" : quiet ? "warn" : "info";
  const format: LogFormat = json ? "json" : "human";
  return { level, format };
}

function main(argv: string[]): Promise<void> | void {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      verbose: { type: "boolean" },
      quiet: { type: "boolean", short: "q" },
      json: { type: "boolean" },
    },
  });

  if (values.version) {
    process.stdout.write(`scanldr ${VERSION}\n`);
    return;
  }

  const [command, ...rest] = positionals;

  if (!command || command === "help" || values.help) {
    process.stdout.write(USAGE);
    return;
  }

  const { level, format } = resolveLogConfig(values);
  const logger = createLogger({ level, format });

  const handler = handlers[command];
  if (!handler) {
    process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
    process.exit(1);
  }

  return handler(rest, { logger });
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(err.exitCode);
    }
    if (err instanceof NotImplementedError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
