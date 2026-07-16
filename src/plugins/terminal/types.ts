export interface StderrControllerOptions {
  /**
   * Drives ANSI vs plain-passthrough mode. Must be the SAME value that gates
   * the progress bar (`progressEnabled`) so bar-state and controller-mode never disagree.
   */
  enabled: boolean;
  /** Injectable underlying sink for tests; defaults to process.stderr.write. */
  write?: (chunk: string) => void;
}

export interface StderrController {
  /**
   * Route logger writes through here. When the bar is live, clears the bar's
   * current line, writes the log line, then re-renders the bar. Plain
   * passthrough when disabled.
   */
  logWrite: (line: string) => void;
  /**
   * Route progress-bar writes through here. Tracks the bar's last-known line
   * so `logWrite` can re-render it after a log. Plain passthrough when disabled.
   */
  barWrite: (chunk: string) => void;
  /**
   * Explicit bar teardown: resets `barActive`/`lastBarLine` so the bar is no
   * longer considered live. Call this whenever the bar's lifecycle ends —
   * both on the happy path (progress.finish()) and on error paths, so a
   * subsequent `logWrite`/`barWrite` (e.g. from a re-entrant walkthrough
   * iteration) never re-renders a stale/phantom bar line from a prior,
   * possibly-aborted run. No-op when disabled.
   */
  endBar: () => void;
}
