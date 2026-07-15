import type { ProgressHandle, ProgressOptions, ProgressState } from "./types.ts";

const BAR_WIDTH = 20;
const THROTTLE_MS = 200; // ~5 updates/sec
const MAX_SAMPLES = 20;
// Line-width budget, not arbitrary: label + ~70 fixed chars (bar, counters, page, avg, ETA) must stay within ~80 cols.
const MAX_LABEL_LEN = 24;

/** Defensive truncation: labels are short by design, but a wrapped line would defeat the in-place \r redraw. */
function truncateLabel(label: string): string {
  if (label.length <= MAX_LABEL_LEN) return label;
  return `${label.slice(0, MAX_LABEL_LEN - 1)}…`;
}

function formatEta(msRemaining: number, hasSample: boolean): string {
  if (!hasSample) return "~--";
  if (!Number.isFinite(msRemaining) || msRemaining <= 0) return "~0s";
  const totalSeconds = Math.round(msRemaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `~${seconds}s`;
  return `~${minutes}min`;
}

function formatAvg(msAvg: number): string {
  if (!Number.isFinite(msAvg) || msAvg <= 0) return "0s";
  const seconds = msAvg / 1000;
  return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
}

function renderBar(percent: number): string {
  const filled = Math.round((percent / 100) * BAR_WIDTH);
  const clamped = Math.max(0, Math.min(BAR_WIDTH, filled));
  const arrow = clamped > 0 && clamped < BAR_WIDTH ? ">" : "";
  const headLen = Math.max(0, clamped - arrow.length);
  const head = "=".repeat(headLen) + arrow;
  const tail = " ".repeat(Math.max(0, BAR_WIDTH - head.length));
  return `[${head}${tail}]`;
}

function renderLine(state: ProgressState): string {
  const {
    currentChapter,
    totalChapters,
    currentPage,
    totalPages,
    percent,
    avgPageMs,
    etaMs,
    label,
  } = state;
  const bar = renderBar(percent);
  const pct = Math.round(percent);
  const hasSample = avgPageMs > 0;
  return `${truncateLabel(label)} [${currentChapter}/${totalChapters}] (page ${currentPage}/${totalPages}) ${bar} ${pct}% • avg ${formatAvg(avgPageMs)}/page • ETA ${formatEta(etaMs, hasSample)}`;
}

/**
 * Creates a stderr progress renderer.
 *
 * Seam choice: driven by explicit updateChapter/updatePage calls from the walkthrough/execute
 * layer (which already knows chapter totals) plus a per-page callback threaded into the
 * downloader, rather than subscribing to logger events. This keeps the renderer decoupled from
 * log event names/shapes (which evolve independently) and avoids double-counting or missed
 * events from log fan-out.
 *
 * When `enabled` is false, every method is a no-op — safe to call unconditionally.
 */
export function createProgress(opts: ProgressOptions): ProgressHandle {
  const {
    enabled,
    totalChapters,
    write = (chunk: string) => {
      process.stderr.write(chunk);
    },
    endBar,
    now = Date.now,
  } = opts;

  let currentChapter = 0;
  let currentPage = 0;
  let totalPages = 0;
  let label = "";
  let lastRenderAt = 0;
  let lastPageStartedAt: number | null = null;
  const pageDurations: number[] = [];

  function computeAvgPageMs(): number {
    if (pageDurations.length === 0) return 0;
    const sum = pageDurations.reduce((a, b) => a + b, 0);
    return sum / pageDurations.length;
  }

  function computePercent(): number {
    if (totalChapters <= 0) return 0;
    const chapterFraction = totalPages > 0 ? Math.min(1, currentPage / totalPages) : 0;
    const completedChapters = Math.max(0, currentChapter - 1);
    const raw = ((completedChapters + chapterFraction) / totalChapters) * 100;
    return Math.max(0, Math.min(100, raw));
  }

  function computeEtaMs(avgPageMs: number): number {
    const remainingPagesInChapter = Math.max(0, totalPages - currentPage);
    const remainingChapters = Math.max(0, totalChapters - currentChapter);
    // Best-effort: assume remaining chapters have a similar page count to the current one.
    const remainingPages = remainingPagesInChapter + remainingChapters * totalPages;
    return remainingPages * avgPageMs;
  }

  function render(force: boolean): void {
    if (!enabled) return;
    const nowMs = now();
    if (!force && nowMs - lastRenderAt < THROTTLE_MS) return;
    lastRenderAt = nowMs;

    const avgPageMs = computeAvgPageMs();
    const state: ProgressState = {
      currentChapter,
      totalChapters,
      currentPage,
      totalPages,
      percent: computePercent(),
      avgPageMs,
      etaMs: computeEtaMs(avgPageMs),
      label,
    };
    write(`\r${renderLine(state)}`);
  }

  return {
    updateChapter(chapterIndex: number, chapterTotalPages: number, bundleLabel: string): void {
      if (!enabled) return;
      currentChapter = chapterIndex;
      currentPage = 0;
      totalPages = chapterTotalPages;
      label = bundleLabel;
      lastPageStartedAt = null;
      render(true);
    },
    updatePage(): void {
      if (!enabled) return;
      const nowMs = now();
      if (lastPageStartedAt !== null) {
        const duration = nowMs - lastPageStartedAt;
        pageDurations.push(duration);
        if (pageDurations.length > MAX_SAMPLES) pageDurations.shift();
      }
      lastPageStartedAt = nowMs;
      // Count completions rather than trusting the caller's dispatch-order index:
      // pages resolve out of order under concurrency, so the Nth completion is page N.
      currentPage += 1;
      render(false);
    },
    finish(): void {
      if (!enabled) return;
      // Force a final render so the true final state (e.g. 100%, last page) is always
      // flushed even if the last updatePage() call was dropped by the throttle.
      render(true);
      write("\n");
      // Explicit teardown: resets the shared controller's bar-state. This is
      // the only thing that flips `barActive` off now — no more sniffing the
      // trailing "\n" for it.
      endBar?.();
    },
  };
}
