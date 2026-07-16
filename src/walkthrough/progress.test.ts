import { describe, expect, test } from "bun:test";
import { createProgress } from "./progress.ts";

function makeClock(startMs = 0) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function makeSink() {
  const chunks: string[] = [];
  return { write: (chunk: string) => chunks.push(chunk), chunks };
}

describe("createProgress — enabled/disabled gating", () => {
  test("disabled: every method is a no-op, nothing written", () => {
    const sink = makeSink();
    const progress = createProgress({ enabled: false, totalChapters: 3, write: sink.write });

    progress.updateChapter(1, 10, "Chapter 1");
    progress.updatePage();
    progress.finish();

    expect(sink.chunks).toEqual([]);
  });

  test("enabled: updateChapter renders immediately (force=true, bypasses throttle)", () => {
    const sink = makeSink();
    const clock = makeClock();
    const progress = createProgress({
      enabled: true,
      totalChapters: 2,
      write: sink.write,
      now: clock.now,
    });

    progress.updateChapter(1, 10, "Chapter 1");

    expect(sink.chunks.length).toBe(1);
    expect(sink.chunks[0]).toContain("Chapter 1 [1/2]");
    expect(sink.chunks[0]).toContain("page 0/10");
  });

  test("enabled: finish() flushes a final render before the trailing newline", () => {
    const sink = makeSink();
    const progress = createProgress({ enabled: true, totalChapters: 1, write: sink.write });

    progress.finish();

    expect(sink.chunks.length).toBe(2);
    expect(sink.chunks[0]).toContain("[0/1]");
    expect(sink.chunks[1]).toBe("\n");
  });

  test("disabled: finish() remains a no-op, no final render or newline written", () => {
    const sink = makeSink();
    const progress = createProgress({ enabled: false, totalChapters: 1, write: sink.write });

    progress.finish();

    expect(sink.chunks).toEqual([]);
  });
});

describe("createProgress — finish() flushes the true final frame", () => {
  test("finish() flushes the final state even when the last updatePage was throttled", () => {
    const sink = makeSink();
    const clock = makeClock();
    const progress = createProgress({
      enabled: true,
      totalChapters: 1,
      write: sink.write,
      now: clock.now,
    });

    progress.updateChapter(1, 10, "Chapter 1"); // force render #1
    sink.chunks.length = 0;

    // Simulate pages 1..9 within the throttle window (all dropped), then the true final
    // page 10 also arrives within the throttle window and gets dropped too.
    for (let i = 1; i <= 10; i++) {
      progress.updatePage();
    }
    expect(sink.chunks.length).toBe(0); // confirm the last updatePage was indeed throttle-dropped

    progress.finish();

    // finish() must flush a final frame showing the TRUE final state (page 10/10, 100%)
    // before writing the trailing newline — not a stale earlier frame.
    expect(sink.chunks.length).toBe(2);
    expect(sink.chunks[0]).toContain("page 10/10");
    expect(sink.chunks[0]).toContain("100%");
    expect(sink.chunks[1]).toBe("\n");
  });
});

describe("createProgress — throttling (~5 updates/sec)", () => {
  test("rapid updatePage calls within the throttle window only render once", () => {
    const sink = makeSink();
    const clock = makeClock();
    const progress = createProgress({
      enabled: true,
      totalChapters: 1,
      write: sink.write,
      now: clock.now,
    });

    progress.updateChapter(1, 100, "Chapter 1"); // force render #1
    sink.chunks.length = 0;

    progress.updatePage(); // within throttle window -> no render
    progress.updatePage(); // within throttle window -> no render
    progress.updatePage(); // within throttle window -> no render

    expect(sink.chunks.length).toBe(0);
  });

  test("advancing the clock past the throttle window allows the next render", () => {
    const sink = makeSink();
    const clock = makeClock();
    const progress = createProgress({
      enabled: true,
      totalChapters: 1,
      write: sink.write,
      now: clock.now,
    });

    progress.updateChapter(1, 100, "Chapter 1");
    sink.chunks.length = 0;

    progress.updatePage();
    expect(sink.chunks.length).toBe(0);

    clock.advance(250); // > 200ms throttle window
    progress.updatePage();

    expect(sink.chunks.length).toBe(1);
    expect(sink.chunks[0]).toContain("page 2/100");
  });
});

describe("createProgress — updatePage advances currentPage per call", () => {
  test("updatePage advances currentPage by one per call", () => {
    const sink = makeSink();
    const clock = makeClock();
    const progress = createProgress({
      enabled: true,
      totalChapters: 1,
      write: sink.write,
      now: clock.now,
    });

    progress.updateChapter(1, 3, "Chapter 1");

    const renderedPages: number[] = [];
    const captureFrame = () => {
      const line = sink.chunks[sink.chunks.length - 1] ?? "";
      const match = line.match(/page (\d+)\/3/);
      if (match?.[1]) renderedPages.push(Number(match[1]));
    };

    // updatePage() has no order/index parameter — it just increments currentPage per call.
    // This test only pins that increment-per-call behavior at this layer; the
    // completion-not-dispatch-order guarantee is enforced by the caller (see progress.ts
    // updatePage() note) and is exercised in downloader/service.test.ts and
    // walkthrough/steps/execute.test.ts.
    clock.advance(300);
    progress.updatePage(); // call #1
    captureFrame();

    clock.advance(300);
    progress.updatePage(); // call #2
    captureFrame();

    clock.advance(300);
    progress.updatePage(); // call #3
    captureFrame();

    expect(renderedPages).toEqual([1, 2, 3]);
  });
});

describe("createProgress — monotonic progress under out-of-order completion", () => {
  test("final frame after finish() shows page N/N and 100% regardless of completion order", () => {
    const sink = makeSink();
    const clock = makeClock();
    const progress = createProgress({
      enabled: true,
      totalChapters: 1,
      write: sink.write,
      now: clock.now,
    });

    // Simulate a bundle of 3 pages fetched concurrently, resolving OUT of dispatch order
    // (e.g. page 3 finishes first, then page 1, then page 2). The renderer never sees an
    // index — it must count completions, so the sequence of rendered pages must be
    // strictly 1, 2, 3 (never backward), ending at 3/3 = 100%.
    progress.updateChapter(1, 3, "Chapter 1");

    const renderedPages: number[] = [];
    const captureFrame = () => {
      const line = sink.chunks[sink.chunks.length - 1] ?? "";
      const match = line.match(/page (\d+)\/3/);
      if (match?.[1]) renderedPages.push(Number(match[1]));
    };

    clock.advance(300);
    progress.updatePage(); // 3rd dispatch resolves 1st -> must render as completion #1
    captureFrame();

    clock.advance(300);
    progress.updatePage(); // 1st dispatch resolves 2nd -> must render as completion #2
    captureFrame();

    clock.advance(300);
    progress.updatePage(); // 2nd dispatch resolves 3rd (last) -> must render as completion #3
    captureFrame();

    // Strictly increasing, no backward step.
    expect(renderedPages).toEqual([1, 2, 3]);

    progress.finish();
    const finalLine = sink.chunks[sink.chunks.length - 2] ?? ""; // frame before trailing "\n"
    expect(finalLine).toContain("page 3/3");
    expect(finalLine).toContain("100%");
  });
});

describe("createProgress — chapter/volume label rendering", () => {
  test("renders label alongside the position index", () => {
    const sink = makeSink();
    const progress = createProgress({ enabled: true, totalChapters: 5, write: sink.write });

    progress.updateChapter(3, 79, "Chapter 33");

    const line = sink.chunks[sink.chunks.length - 1] ?? "";
    expect(line).toContain("Chapter 33 [3/5]");
  });

  test("decimal chapter label renders verbatim", () => {
    const sink = makeSink();
    const progress = createProgress({ enabled: true, totalChapters: 5, write: sink.write });

    progress.updateChapter(5, 20, "Chapter 34.5");

    const line = sink.chunks[sink.chunks.length - 1] ?? "";
    expect(line).toContain("Chapter 34.5 [5/5]");
  });

  test("volume mode label renders", () => {
    const sink = makeSink();
    const progress = createProgress({ enabled: true, totalChapters: 1, write: sink.write });

    progress.updateChapter(1, 30, "Volume 9");

    const line = sink.chunks[sink.chunks.length - 1] ?? "";
    expect(line).toContain("Volume 9 [1/1]");
  });

  test("a long label is truncated with an ellipsis to avoid wrapping the single-line redraw", () => {
    const sink = makeSink();
    const progress = createProgress({ enabled: true, totalChapters: 1, write: sink.write });
    const longLabel = "Chapter 1 — A Very Long Title That Goes On And On Forever";

    progress.updateChapter(1, 10, longLabel);

    const line = sink.chunks[sink.chunks.length - 1] ?? "";
    expect(line).not.toContain(longLabel);
    expect(line).toContain("Chapter 1 — A Very Long…");
  });

  test("empty/initial label (before first updateChapter) does not render 'undefined'", () => {
    const sink = makeSink();
    const progress = createProgress({ enabled: true, totalChapters: 1, write: sink.write });

    progress.finish();

    const line = sink.chunks[0] ?? "";
    expect(line).not.toContain("undefined");
    expect(line).toContain("[0/1]");
  });
});

describe("createProgress — progress math and ETA", () => {
  test("percent reflects completed chapters + fractional progress in the current chapter", () => {
    const sink = makeSink();
    const clock = makeClock();
    const progress = createProgress({
      enabled: true,
      totalChapters: 2,
      write: sink.write,
      now: clock.now,
    });

    // Chapter 1/2, page 5/10 -> 0 completed chapters + 0.5 fraction, over 2 chapters = 25%
    progress.updateChapter(1, 10, "Chapter 1");
    clock.advance(250);
    for (let i = 1; i <= 5; i++) {
      progress.updatePage();
      clock.advance(250);
    }

    const last = sink.chunks[sink.chunks.length - 1] ?? "";
    expect(last).toContain("25%");
  });

  test("ETA shrinks as average page duration is observed and pages complete", () => {
    const sink = makeSink();
    const clock = makeClock();
    const progress = createProgress({
      enabled: true,
      totalChapters: 1,
      write: sink.write,
      now: clock.now,
    });

    progress.updateChapter(1, 4, "Chapter 1");
    clock.advance(1000); // simulate 1s per page
    progress.updatePage();
    clock.advance(1000);
    progress.updatePage();

    const line = sink.chunks[sink.chunks.length - 1] ?? "";
    // avg ~1s/page, 2 pages remaining -> ETA ~2s
    expect(line).toContain("avg 1.0s/page");
    expect(line).toMatch(/ETA ~\ds/);
  });

  test("ETA shows a calculating placeholder at page 0 (no page duration sampled yet)", () => {
    const sink = makeSink();
    const progress = createProgress({ enabled: true, totalChapters: 1, write: sink.write });

    progress.updateChapter(1, 10, "Chapter 1");

    const line = sink.chunks[sink.chunks.length - 1] ?? "";
    expect(line).toContain("ETA ~--");
    expect(line).not.toContain("ETA ~0s");
  });

  test("percent is clamped to 0% when nothing has progressed", () => {
    const sink = makeSink();
    const progress = createProgress({ enabled: true, totalChapters: 3, write: sink.write });

    progress.updateChapter(1, 10, "Chapter 1");

    const line = sink.chunks[sink.chunks.length - 1] ?? "";
    expect(line).toContain("0%");
  });

  test("percent is clamped to 100% and never exceeds it when currentPage > totalPages", () => {
    const sink = makeSink();
    const clock = makeClock();
    const progress = createProgress({
      enabled: true,
      totalChapters: 1,
      write: sink.write,
      now: clock.now,
    });

    progress.updateChapter(1, 5, "Chapter 1");
    clock.advance(300);
    // Overshoot: more completions than totalPages (e.g. a stray extra callback).
    for (let i = 0; i < 7; i++) {
      clock.advance(300);
      progress.updatePage();
    }

    const line = sink.chunks[sink.chunks.length - 1] ?? "";
    expect(line).toContain(" 100% ");
  });

  test("percent guards the totalPages === 0 case (no division by zero / NaN)", () => {
    const sink = makeSink();
    const progress = createProgress({ enabled: true, totalChapters: 2, write: sink.write });

    progress.updateChapter(1, 0, "Chapter 1");

    const line = sink.chunks[sink.chunks.length - 1] ?? "";
    expect(line).toContain("0%");
    expect(line).not.toContain("NaN");
  });

  test("updateChapter resets the page counter and total pages for the new chapter", () => {
    const sink = makeSink();
    const clock = makeClock();
    const progress = createProgress({
      enabled: true,
      totalChapters: 2,
      write: sink.write,
      now: clock.now,
    });

    progress.updateChapter(1, 10, "Chapter 1");
    progress.updatePage();
    clock.advance(300);
    progress.updateChapter(2, 20, "Chapter 2");

    const line = sink.chunks[sink.chunks.length - 1] ?? "";
    expect(line).toContain("Chapter 2 [2/2]");
    expect(line).toContain("page 0/20");
  });
});
