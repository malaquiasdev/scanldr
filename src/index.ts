#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { runDownload } from "@commands/download/index.ts";
import { runHistoryClear, runHistoryList } from "@commands/history/index.ts";
import { runList } from "@commands/list/index.ts";
import { CloudflareError, MissingAuthError } from "@integrations/fallback-http/index.ts";
import { createMangaDexClient } from "@integrations/mangadex/client/index.ts";
import { createMangaDexHttp } from "@integrations/mangadex/http/index.ts";
import { AuthError, runAuth } from "@integrations/mangakakalot/auth/index.ts";
import { loadConfig } from "@plugins/config/index.ts";
import { openDb, runMigrations } from "@plugins/db/index.ts";
import { CliError } from "@plugins/errors/index.ts";
import { type LogFormat, type LogLevel, createLogger } from "@plugins/logger/index.ts";
import type { Handler } from "./cli/types.ts";

const VERSION = "0.0.0";

const USAGE = `scanldr — offline downloader for manga, HQ, manhwa, and webtoon

Usage:
  scanldr <command> [args] [flags]

Commands:
  auth                          Capture session via piped cURL (pbpaste | scanldr auth)
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
  history [--manga <m>] [--source <s>] [--limit <n>]  Display download history (default limit 50)
  history clear [--manga <m>] [--source <s>] [--yes]  Delete history records
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

const handlers: Record<string, Handler> = {
  auth: async (_rest, ctx) => {
    await runAuth({ logger: ctx.logger });
  },
  list: async (rest, ctx) => {
    const { values: listValues, positionals: listPos } = parseArgs({
      args: rest,
      allowPositionals: true,
      strict: true,
      options: {
        volume: { type: "string" },
        chapter: { type: "string" },
        "non-tty": { type: "boolean" },
      },
    });

    const manga = listPos[0];
    if (!manga) {
      throw new CliError("Usage: scanldr list <manga> [--volume <n>] [--chapter <n>]", 2);
    }

    const nonTty = listValues["non-tty"] === true || !process.stdout.isTTY;

    const http = createMangaDexHttp({ logger: ctx.logger, config: ctx.config });
    const client = createMangaDexClient(http);

    await runList(
      {
        manga,
        volume: typeof listValues.volume === "string" ? listValues.volume : undefined,
        chapter: typeof listValues.chapter === "string" ? listValues.chapter : undefined,
        nonTty,
      },
      { logger: ctx.logger, languages: ctx.config.preferred_languages },
      client,
    );
  },
  download: async (rest, ctx) => {
    const { values: dlValues, positionals: dlPos } = parseArgs({
      args: normalizePackFlag(rest),
      allowPositionals: true,
      strict: true,
      options: {
        volume: { type: "string" },
        chapter: { type: "string" },
        format: { type: "string" },
        out: { type: "string" },
        quality: { type: "string" },
        concurrency: { type: "string" },
        "delay-ms": { type: "string" },
        force: { type: "boolean" },
        "no-track": { type: "boolean" },
        "dry-run": { type: "boolean" },
        "non-tty": { type: "boolean" },
        pack: { type: "string" },
        "pack-replace": { type: "boolean" },
        "pack-overwrite": { type: "boolean" },
        "cover-url": { type: "string" },
      },
    });

    const manga = dlPos[0];
    if (!manga) {
      throw new CliError("Usage: scanldr download <manga> --volume <range> [flags]", 2);
    }

    if (dlValues.volume !== undefined && dlValues.chapter !== undefined) {
      throw new CliError("--volume and --chapter are mutually exclusive", 2);
    }

    if (dlValues.volume === undefined && dlValues.chapter === undefined) {
      throw new CliError("--volume <range> or --chapter <range> is required", 2);
    }

    const rawFormat = dlValues.format;
    const format =
      rawFormat === "zip" ? "zip" : rawFormat === "cbz" ? "cbz" : ctx.config.default_format;

    const rawQuality = dlValues.quality;
    const quality =
      rawQuality === "data-saver"
        ? "data-saver"
        : rawQuality === "data"
          ? "data"
          : ctx.config.download_quality;

    const rawConcurrency = dlValues.concurrency;
    const concurrency =
      typeof rawConcurrency === "string" && /^\d+$/.test(rawConcurrency)
        ? Number(rawConcurrency)
        : ctx.config.image_concurrency;

    const rawDelay = dlValues["delay-ms"];
    const delayMs =
      typeof rawDelay === "string" && /^\d+$/.test(rawDelay)
        ? Number(rawDelay)
        : ctx.config.chapter_delay_ms;

    const http = createMangaDexHttp({ logger: ctx.logger, config: ctx.config });
    const client = createMangaDexClient(http);

    // --pack can be a string (custom name) or bare boolean (no value → empty string from parseArgs)
    const rawPack = dlValues.pack;
    const packArg: string | boolean | undefined =
      rawPack === "" ? true : typeof rawPack === "string" ? rawPack : undefined;

    await runDownload(
      {
        manga,
        volume: typeof dlValues.volume === "string" ? dlValues.volume : undefined,
        chapter: typeof dlValues.chapter === "string" ? dlValues.chapter : undefined,
        format,
        outDir: typeof dlValues.out === "string" ? dlValues.out : ctx.config.default_out,
        quality,
        concurrency,
        delayMs,
        force: dlValues.force === true,
        noTrack: dlValues["no-track"] === true,
        dryRun: dlValues["dry-run"] === true,
        nonTty: dlValues["non-tty"] === true || !process.stdout.isTTY,
        pack: packArg,
        packReplace: dlValues["pack-replace"] === true,
        packOverwrite: dlValues["pack-overwrite"] === true,
        coverUrl: typeof dlValues["cover-url"] === "string" ? dlValues["cover-url"] : undefined,
      },
      { logger: ctx.logger, config: ctx.config, db: ctx.db },
      client,
      http,
    );
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
  history: async (rest, ctx) => {
    // Sub-command dispatch: `history clear [...]` vs `history [list flags]`
    const sub = rest[0];
    if (sub === "clear") {
      const { values } = parseArgs({
        args: rest.slice(1),
        allowPositionals: false,
        strict: true,
        options: {
          manga: { type: "string" },
          source: { type: "string" },
          yes: { type: "boolean" },
        },
      });
      await runHistoryClear(
        {
          manga: typeof values.manga === "string" ? values.manga : undefined,
          source: typeof values.source === "string" ? values.source : undefined,
          yes: values.yes === true,
        },
        ctx.db,
      );
    } else {
      const { values } = parseArgs({
        args: rest,
        allowPositionals: false,
        strict: true,
        options: {
          manga: { type: "string" },
          source: { type: "string" },
          limit: { type: "string" },
        },
      });
      const rawLimit = values.limit;
      const limit = typeof rawLimit === "string" && /^\d+$/.test(rawLimit) ? Number(rawLimit) : 50;
      await runHistoryList(
        {
          manga: typeof values.manga === "string" ? values.manga : undefined,
          source: typeof values.source === "string" ? values.source : undefined,
          limit,
        },
        ctx.db,
      );
    }
  },
};

/**
 * Pre-process argv so that a bare `--pack` (not followed by a value) becomes
 * `--pack=` (empty string). This lets parseArgs treat it as type:"string" while
 * still allowing the rawPack === "" branch to convert it to boolean true.
 *
 * Cases handled:
 *   --pack           (end of argv)      → --pack=
 *   --pack --other   (next is a flag)   → --pack= --other
 *   --pack=name                         → unchanged
 *   --pack name                         → unchanged (parseArgs consumes "name")
 */
export function normalizePackFlag(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pack") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out.push("--pack="); // bare form — inject empty value
        continue;
      }
    }
    out.push(a as string);
  }
  return out;
}

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

  const level: LogLevel = quiet ? "warn" : "info";
  const format: LogFormat = json ? "json" : "human";
  return { level, format };
}

/**
 * Walk argv to find the first non-flag token (the command name).
 * Everything before it goes into preArgs (parsed only for global boolean flags).
 * Everything after it is passed verbatim as postArgs to the handler's own parseArgs.
 *
 * This avoids the bug where strict:false at the top level coerces
 * "--volume 13" into { volume: true } and pushes "13" into positionals.
 */
function splitArgv(argv: string[]): {
  preArgs: string[];
  command: string | undefined;
  postArgs: string[];
} {
  const preArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok) {
      i++;
      continue;
    }
    if (tok.startsWith("-")) {
      // Only known global boolean flags are expected pre-command; collect them all anyway.
      preArgs.push(tok);
    } else {
      return { preArgs, command: tok, postArgs: argv.slice(i + 1) };
    }
  }
  return { preArgs, command: undefined, postArgs: [] };
}

export async function main(argv: string[]): Promise<void> {
  const { preArgs, command, postArgs } = splitArgv(argv);

  // Parse only global boolean flags from the pre-command slice.
  const { values } = parseArgs({
    args: preArgs,
    allowPositionals: false,
    strict: false, // tolerate unknown flags silently; handlers validate their own slice
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

  const { config } = await loadConfig();
  const db = openDb(config.db_path);
  runMigrations(db);

  // postArgs is everything after the command — verbatim, so handler's parseArgs
  // sees the real flag values (e.g. --volume "13" not boolean true).
  return handler(postArgs, { logger, db, config });
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
