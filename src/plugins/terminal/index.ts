// Shared stderr coordinator — see docs/conventions.md.
// Both the logger and the progress bar route their `write` seam through this
// controller so chapter-level logs and warnings never clobber the live bar.

import type { StderrController, StderrControllerOptions } from "./types.ts";

export type { StderrController, StderrControllerOptions } from "./types.ts";

const CLEAR_LINE = "\r\x1b[2K";

/**
 * Creates the shared stderr controller.
 *
 * When `enabled` is false (non-TTY / piped / JSON mode) this is a plain
 * passthrough — no ANSI escapes are ever emitted, so non-TTY output stays
 * byte-identical to today. When `enabled` is true, `logWrite` clears the
 * bar's current line, writes the log, then re-renders the bar; `barWrite`
 * tracks the bar's last-known line and renders it in place.
 */
export function createStderrController(options: StderrControllerOptions): StderrController {
  const { enabled, write = (chunk: string) => process.stderr.write(chunk) } = options;

  let lastBarLine = "";
  let barActive = false;

  if (!enabled) {
    return {
      logWrite: (line: string) => write(line),
      barWrite: (chunk: string) => write(chunk),
      endBar: () => {},
    };
  }

  return {
    logWrite(line: string): void {
      if (!barActive) {
        write(line);
        return;
      }
      write(CLEAR_LINE);
      write(line);
      // No clear needed before this redraw: `line` is always newline-terminated
      // (the logger appends `\n`), so the cursor is already on a fresh empty
      // line when the bar is re-rendered here.
      write(`\r${lastBarLine}`);
    },
    barWrite(chunk: string): void {
      // Every chunk (including a bare "\n") is a normal bar render/passthrough.
      // Finish-state is no longer inferred by sniffing bytes here — callers
      // signal teardown explicitly via `endBar()`.
      lastBarLine = chunk.startsWith("\r") ? chunk.slice(1) : chunk;
      barActive = true;
      write(chunk);
    },
    endBar(): void {
      barActive = false;
      lastBarLine = "";
    },
  };
}
