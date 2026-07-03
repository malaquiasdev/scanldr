import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChapterInput, ImageRef } from "@integrations/_shared/media.ts";
import { createLogger } from "../plugins/logger/index.ts";
import { downloadBundle } from "./service.ts";
import type { DownloadBundleInput } from "./types.ts";

const noop = () => {};
const logger = createLogger({ level: "info", format: "human", write: noop });

function makeChapter(id: string, num: number, pageCount: number, delaysMs: number[]): ChapterInput {
  const pages: ImageRef[] = Array.from({ length: pageCount }, (_, i) => ({
    url: `https://example.com/${id}/${i + 1}.jpg`,
    page: i + 1,
  }));
  return {
    id,
    num,
    pages,
    imageFetcher: async (ref: ImageRef) => {
      const idx = ref.page - 1;
      const delay = delaysMs[idx] ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      // 1x1 png bytes so detectExtFromBytes has something to sniff.
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    },
  };
}

describe("downloadBundle — onPageProgress under concurrent fetches", () => {
  test("fires exactly once per page, in completion order, even when the low-index page resolves last", async () => {
    const outDir = join(tmpdir(), `downloader-test-${Date.now()}-${Math.random()}`);

    // Chapter A: page 1 is slow, page 2/3 are fast -> pages 2/3 complete BEFORE page 1.
    // This is the exact shape that breaks a naive "currentPage = dispatch index" model:
    // the low-index page resolving last must not cause the progress consumer to regress.
    const chapterA = makeChapter("a", 1, 3, [50, 5, 5]);
    // Chapter B: normal order.
    const chapterB = makeChapter("b", 2, 2, [0, 0]);

    let completionCount = 0;
    const completionCounts: number[] = [];

    const input: DownloadBundleInput = {
      outDir,
      format: "cbz",
      slug: "test-manga",
      kind: "chapter",
      bundleNumber: "1",
      chapters: [chapterA, chapterB],
      imageConcurrency: 3, // > 1: exercise the semaphore-limited concurrency
      delayMs: 0,
      dryRun: false,
      logger,
      onPageProgress: (totalPages) => {
        completionCount += 1;
        completionCounts.push(completionCount);
        expect(totalPages).toBe(5);
      },
    };

    try {
      await downloadBundle(input);

      // Exactly one callback per page across both chapters.
      expect(completionCount).toBe(5);

      // The completion counter must be strictly monotonic (1,2,3,4,5) regardless of the
      // underlying dispatch-order resolution — no backward steps, no gaps, no dupes.
      expect(completionCounts).toEqual([1, 2, 3, 4, 5]);

      // The final callback must report the true total (100% equivalent).
      expect(completionCounts[completionCounts.length - 1]).toBe(5);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test("onPageProgress is optional — downloadBundle works fine without it", async () => {
    const outDir = join(tmpdir(), `downloader-test-${Date.now()}-${Math.random()}`);
    const chapter = makeChapter("c", 1, 2, [0, 0]);

    const input: DownloadBundleInput = {
      outDir,
      format: "cbz",
      slug: "no-progress",
      kind: "chapter",
      bundleNumber: "1",
      chapters: [chapter],
      imageConcurrency: 2,
      delayMs: 0,
      dryRun: false,
      logger,
    };

    try {
      const result = await downloadBundle(input);
      expect(result.chapterIds).toEqual(["c"]);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
