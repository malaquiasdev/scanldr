import { describe, expect, test } from "bun:test";
import { createStderrController } from "./index.ts";

function makeSink() {
  const chunks: string[] = [];
  return { write: (chunk: string) => chunks.push(chunk), chunks };
}

describe("createStderrController — enabled (ANSI mode)", () => {
  test("log write while bar is active clears the line, writes the log, re-renders the bar", () => {
    const sink = makeSink();
    const controller = createStderrController({ enabled: true, write: sink.write });

    controller.barWrite("\rChapter 1/5 (page 0/85) [                    ] 0%");
    controller.logWrite("2026-07-15T12:00:00.000Z info downloading chapter\n");

    expect(sink.chunks).toEqual([
      "\rChapter 1/5 (page 0/85) [                    ] 0%",
      "\r\x1b[2K",
      "2026-07-15T12:00:00.000Z info downloading chapter\n",
      "\rChapter 1/5 (page 0/85) [                    ] 0%",
    ]);
  });

  test("log write before any bar render is a plain passthrough (no clear escape)", () => {
    const sink = makeSink();
    const controller = createStderrController({ enabled: true, write: sink.write });

    controller.logWrite("2026-07-15T12:00:00.000Z info starting\n");

    expect(sink.chunks).toEqual(["2026-07-15T12:00:00.000Z info starting\n"]);
  });

  test("warning mid-download is present (not suppressed) and appears above the bar", () => {
    const sink = makeSink();
    const controller = createStderrController({ enabled: true, write: sink.write });

    controller.barWrite("\rChapter 2/5 (page 40/85) [====>               ] 20%");
    controller.logWrite("2026-07-15T12:00:00.000Z warn mangakakalot.rate_limited\n");

    expect(sink.chunks).toContain("2026-07-15T12:00:00.000Z warn mangakakalot.rate_limited\n");
    // bar is re-rendered after the warning, pinned back at the bottom
    expect(sink.chunks.at(-1)).toBe("\rChapter 2/5 (page 40/85) [====>               ] 20%");
  });

  test("finish flow (final render + trailing newline + explicit endBar()) flushes the final line and marks the bar inactive", () => {
    const sink = makeSink();
    const controller = createStderrController({ enabled: true, write: sink.write });

    controller.barWrite("\rChapter 5/5 (page 85/85) [====================] 100%");
    controller.barWrite("\n"); // progress.finish()'s trailing newline write — now a normal bar write
    controller.endBar(); // progress.finish()'s explicit teardown call

    expect(sink.chunks).toEqual(["\rChapter 5/5 (page 85/85) [====================] 100%", "\n"]);

    // Subsequent logs must not re-render the now-stale bar.
    controller.logWrite("2026-07-15T12:00:00.000Z info done\n");
    expect(sink.chunks.at(-1)).toBe("2026-07-15T12:00:00.000Z info done\n");
  });

  test("a bare '\\n' passed to barWrite is a normal write, no longer a magic finish signal", () => {
    const sink = makeSink();
    const controller = createStderrController({ enabled: true, write: sink.write });

    controller.barWrite("\rChapter 3/5 (page 10/85) [====>               ] 20%");
    controller.barWrite("\n");

    // Bar is still considered active — a bare "\n" no longer flips barActive off.
    controller.logWrite("2026-07-15T12:00:00.000Z info still going\n");
    expect(sink.chunks.at(-1)).toBe("\r\n"); // logWrite re-renders the last barWrite's chunk ("\n") in place
  });

  test("endBar() explicitly resets bar state — a log write after it does not re-render a stale bar", () => {
    const sink = makeSink();
    const controller = createStderrController({ enabled: true, write: sink.write });

    controller.barWrite("\rChapter 1/5 (page 0/85) [                    ] 0%");
    controller.endBar();

    controller.logWrite("2026-07-15T12:00:00.000Z info after teardown\n");
    expect(sink.chunks).toEqual([
      "\rChapter 1/5 (page 0/85) [                    ] 0%",
      "2026-07-15T12:00:00.000Z info after teardown\n",
    ]);
  });

  test("error-then-reenter — a bundle throws mid-bar (finish bypassed), but endBar() teardown (called via finally) resets state so the NEXT iteration's bar isn't clobbered by a phantom stale redraw", () => {
    const sink = makeSink();
    const controller = createStderrController({ enabled: true, write: sink.write });

    // Iteration 1: bar renders, then the bundle throws — finish() is bypassed,
    // but the caller's try/finally still calls endBar() as teardown.
    controller.barWrite("\rChapter 2/5 (page 30/85) [===>                ] 15%");
    controller.endBar();

    // Iteration 2 (post-download-loop re-entry): a log fires before any new bar
    // render — must be a plain passthrough, NOT a redraw of the aborted bar.
    controller.logWrite("2026-07-15T12:00:00.000Z info starting new iteration\n");
    expect(sink.chunks).toEqual([
      "\rChapter 2/5 (page 30/85) [===>                ] 15%",
      "2026-07-15T12:00:00.000Z info starting new iteration\n",
    ]);

    // New bar renders cleanly for iteration 2, unaffected by the prior aborted run.
    controller.barWrite("\rChapter 1/3 (page 0/40) [                    ] 0%");
    expect(sink.chunks.at(-1)).toBe("\rChapter 1/3 (page 0/40) [                    ] 0%");
  });
});

describe("createStderrController — disabled (plain passthrough)", () => {
  test("log and bar writes emit no ANSI escapes — byte-identical passthrough", () => {
    const sink = makeSink();
    const controller = createStderrController({ enabled: false, write: sink.write });

    controller.barWrite("\rChapter 1/5 (page 0/85) [                    ] 0%");
    controller.logWrite("2026-07-15T12:00:00.000Z info downloading chapter\n");
    controller.barWrite("\n");
    controller.endBar(); // no-op in disabled mode; must not throw or emit

    expect(sink.chunks).toEqual([
      "\rChapter 1/5 (page 0/85) [                    ] 0%",
      "2026-07-15T12:00:00.000Z info downloading chapter\n",
      "\n",
    ]);
    expect(sink.chunks.join("")).not.toContain("\x1b[2K");
  });
});
