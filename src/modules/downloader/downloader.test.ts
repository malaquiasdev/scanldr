import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadBundle } from "@modules/downloader/index.ts";
import type { ChapterInput, ImageRef } from "@modules/downloader/types.ts";
import type { Logger } from "@plugins/logger/index.ts";
import { unzipSync } from "fflate";
import { detectExtFromBytes, padBundleNumber } from "./helpers.ts";

const noopLogger: Logger = {
  error: (_f, _m) => {},
  warn: (_f, _m) => {},
  info: (_f, _m) => {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a deterministic PNG-magic Uint8Array of `size` bytes. */
function makePng(seed: number, size = 64): Uint8Array {
  const buf = new Uint8Array(size);
  // PNG magic bytes
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf.fill(seed & 0xff, 4);
  return buf;
}

/** Simple JPEG-magic bytes. */
function makeJpeg(seed: number, size = 64): Uint8Array {
  const buf = new Uint8Array(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf.fill(seed & 0xff, 2);
  return buf;
}

function makeWebP(size = 32): Uint8Array {
  const buf = new Uint8Array(Math.max(size, 12));
  // RIFF at 0-3
  buf[0] = 0x52;
  buf[1] = 0x49;
  buf[2] = 0x46;
  buf[3] = 0x46;
  // file size at 4-7 (arbitrary)
  buf[4] = 0x00;
  buf[5] = 0x00;
  buf[6] = 0x00;
  buf[7] = 0x00;
  // WEBP at 8-11
  buf[8] = 0x57;
  buf[9] = 0x45;
  buf[10] = 0x42;
  buf[11] = 0x50;
  return buf;
}

function makeGif(size = 16): Uint8Array {
  const buf = new Uint8Array(Math.max(size, 4));
  // GIF8
  buf[0] = 0x47;
  buf[1] = 0x49;
  buf[2] = 0x46;
  buf[3] = 0x38;
  return buf;
}

/** Build a trivial chapter with n pages. */
function makeChapter(
  id: string,
  num: number,
  pageCount: number,
  fetcher?: (ref: ImageRef) => Promise<Uint8Array>,
): ChapterInput {
  const pages: ImageRef[] = [];
  for (let i = 1; i <= pageCount; i++) {
    pages.push({ url: `https://cdn.example.com/${id}/page-${i}.png`, page: i });
  }
  return { id, num, pages, imageFetcher: fetcher ?? makeFetcher() };
}

/** A fetcher that returns deterministic PNG bytes per URL. */
function makeFetcher(
  data: Map<string, Uint8Array> = new Map(),
): (ref: ImageRef) => Promise<Uint8Array> {
  return async (ref: ImageRef) => {
    const known = data.get(ref.url);
    if (known) return known;
    return makePng(ref.page);
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let outDir: string;

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), "scanldr-dl-"));
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// padBundleNumber unit tests
// ---------------------------------------------------------------------------

describe("padBundleNumber", () => {
  test('"1" → "001"', () => expect(padBundleNumber("1", 3)).toBe("001"));
  test('"103" → "103"', () => expect(padBundleNumber("103", 3)).toBe("103"));
  test('"18.5" → "018.5"', () => expect(padBundleNumber("18.5", 3)).toBe("018.5"));
  test('"1.25" → "001.25"', () => expect(padBundleNumber("1.25", 3)).toBe("001.25"));
  test('"none" → "none"', () => expect(padBundleNumber("none", 3)).toBe("none"));
});

// ---------------------------------------------------------------------------
// Archive structure — volume
// ---------------------------------------------------------------------------

describe("downloadBundle — volume archive structure", () => {
  test("produces correct filename and directory layout", async () => {
    const result = await downloadBundle({
      outDir,
      format: "cbz",
      slug: "witch-hat-atelier",
      kind: "volume",
      bundleNumber: "3",
      chapters: [makeChapter("ch-018", 18, 2), makeChapter("ch-019", 19, 1)],
      imageConcurrency: 2,
      delayMs: 0,
      dryRun: false,
      logger: noopLogger,
    });

    expect(result.outputPath).toBe(
      join(outDir, "witch-hat-atelier", "witch-hat-atelier-volume-003.cbz"),
    );
    expect(result.chapterIds).toEqual(["ch-018", "ch-019"]);
    expect(result.byteSize).toBeGreaterThan(0);

    // File must exist at the final path (not .temp)
    const stat = await readFile(result.outputPath);
    expect(stat.length).toBe(result.byteSize);
  });

  test("three-digit volume zero-padding", async () => {
    const result = await downloadBundle({
      outDir,
      format: "cbz",
      slug: "test-manga",
      kind: "volume",
      bundleNumber: "1",
      chapters: [makeChapter("ch-001", 1, 1)],
      imageConcurrency: 1,
      delayMs: 0,
      dryRun: false,
      logger: noopLogger,
    });

    expect(result.outputPath).toContain("volume-001.cbz");
  });

  test("volume 103 pads correctly", async () => {
    const result = await downloadBundle({
      outDir,
      format: "cbz",
      slug: "test",
      kind: "volume",
      bundleNumber: "103",
      chapters: [makeChapter("c1", 1, 1)],
      imageConcurrency: 1,
      delayMs: 0,
      dryRun: false,
      logger: noopLogger,
    });
    expect(result.outputPath).toContain("volume-103.cbz");
  });
});

// ---------------------------------------------------------------------------
// Archive structure — chapter
// ---------------------------------------------------------------------------

describe("downloadBundle — chapter archive structure", () => {
  test("chapter kind generates correct filename", async () => {
    const result = await downloadBundle({
      outDir,
      format: "cbz",
      slug: "one-piece",
      kind: "chapter",
      bundleNumber: "1",
      chapters: [makeChapter("ch-001", 1, 2)],
      imageConcurrency: 1,
      delayMs: 0,
      dryRun: false,
      logger: noopLogger,
    });
    expect(result.outputPath).toContain("one-piece-chapter-001.cbz");
  });

  test("decimal chapter number is padded correctly", async () => {
    const result = await downloadBundle({
      outDir,
      format: "cbz",
      slug: "test-manga",
      kind: "chapter",
      bundleNumber: "18.5",
      chapters: [makeChapter("ch-018-5", 18, 1)],
      imageConcurrency: 1,
      delayMs: 0,
      dryRun: false,
      logger: noopLogger,
    });
    expect(result.outputPath).toContain("test-manga-chapter-018.5.cbz");
  });
});

// ---------------------------------------------------------------------------
// Page order invariant
// ---------------------------------------------------------------------------

describe("downloadBundle — page ordering", () => {
  test("pages are sorted across chapters in ascending order", async () => {
    // Two chapters with 3 pages each. Chapters passed out-of-order to verify sorting.
    const result = await downloadBundle({
      outDir,
      format: "cbz",
      slug: "sorted-manga",
      kind: "volume",
      bundleNumber: "1",
      chapters: [
        makeChapter("ch-002", 2, 3), // chapter 2 first in input
        makeChapter("ch-001", 1, 3), // chapter 1 second in input
      ],
      imageConcurrency: 1,
      delayMs: 0,
      dryRun: false,
      logger: noopLogger,
    });

    const raw = await readFile(result.outputPath);
    const entries = unzipSync(raw);
    const names = Object.keys(entries).sort();

    // Expect 6 sequentially named files
    expect(names).toEqual(["0001.png", "0002.png", "0003.png", "0004.png", "0005.png", "0006.png"]);
  });

  test("single chapter pages numbered from 0001", async () => {
    const result = await downloadBundle({
      outDir,
      format: "cbz",
      slug: "single-ch",
      kind: "volume",
      bundleNumber: "1",
      chapters: [makeChapter("ch-1", 1, 5)],
      imageConcurrency: 2,
      delayMs: 0,
      dryRun: false,
      logger: noopLogger,
    });

    const raw = await readFile(result.outputPath);
    const entries = unzipSync(raw);
    const names = Object.keys(entries).sort();
    expect(names[0]).toBe("0001.png");
    expect(names[names.length - 1]).toBe("0005.png");
  });
});

// ---------------------------------------------------------------------------
// Concurrency limit
// ---------------------------------------------------------------------------

describe("downloadBundle — concurrency limit", () => {
  test("never exceeds imageConcurrency in-flight fetches", async () => {
    const limit = 3;
    let inFlight = 0;
    let maxObserved = 0;

    const fetcher = async (_ref: ImageRef): Promise<Uint8Array> => {
      inFlight++;
      maxObserved = Math.max(maxObserved, inFlight);
      // Simulate async work
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return makePng(1);
    };

    const pages = 12; // 12 pages, concurrency 3 → max in-flight must be ≤ 3
    await downloadBundle({
      outDir,
      format: "cbz",
      slug: "concurrency-test",
      kind: "volume",
      bundleNumber: "1",
      chapters: [makeChapter("ch-1", 1, pages, fetcher)],
      imageConcurrency: limit,
      delayMs: 0,
      dryRun: false,
      logger: noopLogger,
    });

    expect(maxObserved).toBeLessThanOrEqual(limit);
    expect(maxObserved).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Dry-run
// ---------------------------------------------------------------------------

describe("downloadBundle — dry-run", () => {
  test("returns planned path with [dry-run] prefix", async () => {
    let fetchCalled = false;
    const fetcher = async (_ref: ImageRef): Promise<Uint8Array> => {
      fetchCalled = true;
      return makePng(1);
    };

    const result = await downloadBundle({
      outDir,
      format: "cbz",
      slug: "dry-test",
      kind: "volume",
      bundleNumber: "5",
      chapters: [makeChapter("ch-050", 50, 3, fetcher)],
      imageConcurrency: 2,
      delayMs: 0,
      dryRun: true,
      logger: noopLogger,
    });

    expect(fetchCalled).toBe(false);
    expect(result.outputPath).toContain("[dry-run]");
    expect(result.outputPath).toContain("dry-test-volume-005.cbz");
    expect(result.byteSize).toBe(0);
    expect(result.chapterIds).toContain("ch-050");
  });

  test("dry-run does not write any files", async () => {
    await downloadBundle({
      outDir,
      format: "cbz",
      slug: "no-files",
      kind: "volume",
      bundleNumber: "1",
      chapters: [makeChapter("c1", 1, 2)],
      imageConcurrency: 1,
      delayMs: 0,
      dryRun: true,
      logger: noopLogger,
    });

    // outDir should still be empty
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(outDir);
    expect(entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Interruption simulation — .temp file, no final file
// ---------------------------------------------------------------------------

describe("downloadBundle — interruption simulation", () => {
  test("partial failure leaves no final .cbz when fetcher throws mid-stream", async () => {
    let callCount = 0;
    const fetcher = async (_ref: ImageRef): Promise<Uint8Array> => {
      callCount++;
      if (callCount >= 3) throw new Error("simulated network failure");
      return makePng(callCount);
    };

    await expect(
      downloadBundle({
        outDir,
        format: "cbz",
        slug: "interrupted",
        kind: "volume",
        bundleNumber: "1",
        chapters: [makeChapter("ch-1", 1, 5, fetcher)],
        imageConcurrency: 1,
        delayMs: 0,
        dryRun: false,
        logger: noopLogger,
      }),
    ).rejects.toThrow("simulated network failure");

    // Final .cbz must NOT exist
    const { access, constants } = await import("node:fs/promises");
    const finalPath = join(outDir, "interrupted", "interrupted-volume-001.cbz");
    await expect(access(finalPath, constants.F_OK)).rejects.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// chapterIds in result
// ---------------------------------------------------------------------------

describe("downloadBundle — result metadata", () => {
  test("chapterIds preserves input order", async () => {
    const result = await downloadBundle({
      outDir,
      format: "cbz",
      slug: "meta-test",
      kind: "volume",
      bundleNumber: "1",
      chapters: [
        makeChapter("z-chapter", 3, 1),
        makeChapter("a-chapter", 1, 1),
        makeChapter("m-chapter", 2, 1),
      ],
      imageConcurrency: 1,
      delayMs: 0,
      dryRun: false,
      logger: noopLogger,
    });

    // chapterIds is derived from input chapters array (not sorted order)
    expect(result.chapterIds).toEqual(["z-chapter", "a-chapter", "m-chapter"]);
  });
});

// ---------------------------------------------------------------------------
// PNG magic detection (no explicit content-type)
// ---------------------------------------------------------------------------

describe("downloadBundle — extension detection from bytes", () => {
  test("detects PNG from magic bytes when fetcher returns PNG data", async () => {
    const result = await downloadBundle({
      outDir,
      format: "cbz",
      slug: "ext-detect",
      kind: "volume",
      bundleNumber: "1",
      chapters: [makeChapter("c1", 1, 3, async (_ref) => makePng(1))],
      imageConcurrency: 1,
      delayMs: 0,
      dryRun: false,
      logger: noopLogger,
    });

    const raw = await readFile(result.outputPath);
    const entries = unzipSync(raw);
    const names = Object.keys(entries);
    for (const name of names) {
      expect(name).toMatch(/\.png$/);
    }
  });

  test("falls back to .jpg for non-PNG magic bytes", async () => {
    const result = await downloadBundle({
      outDir,
      format: "cbz",
      slug: "ext-fallback",
      kind: "volume",
      bundleNumber: "1",
      chapters: [makeChapter("c1", 1, 2, async (_ref) => makeJpeg(1))],
      imageConcurrency: 1,
      delayMs: 0,
      dryRun: false,
      logger: noopLogger,
    });

    const raw = await readFile(result.outputPath);
    const entries = unzipSync(raw);
    const names = Object.keys(entries);
    for (const name of names) {
      expect(name).toMatch(/\.jpg$/);
    }
  });

  test("detects WebP from RIFF+WEBP magic bytes", async () => {
    const result = await downloadBundle({
      outDir,
      format: "cbz",
      slug: "ext-webp",
      kind: "volume",
      bundleNumber: "1",
      chapters: [makeChapter("c1", 1, 2, async (_ref) => makeWebP())],
      imageConcurrency: 1,
      delayMs: 0,
      dryRun: false,
      logger: noopLogger,
    });

    const raw = await readFile(result.outputPath);
    const entries = unzipSync(raw);
    const names = Object.keys(entries);
    for (const name of names) {
      expect(name).toMatch(/\.webp$/);
    }
  });
});

// ---------------------------------------------------------------------------
// detectExtFromBytes — unit tests
// ---------------------------------------------------------------------------

describe("detectExtFromBytes", () => {
  test("returns .png for PNG magic bytes", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
    expect(detectExtFromBytes(bytes)).toBe(".png");
  });

  test("returns .jpg for JPEG magic bytes (FF D8 FF)", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(detectExtFromBytes(bytes)).toBe(".jpg");
  });

  test("returns .webp for RIFF+WEBP magic bytes", () => {
    expect(detectExtFromBytes(makeWebP())).toBe(".webp");
  });

  test("returns null for RIFF bytes without WEBP marker (insufficient length)", () => {
    // Only 11 bytes — can't check bytes[8..11] fully
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
    ]);
    expect(detectExtFromBytes(bytes)).toBe(null);
  });

  test("returns .gif for GIF8 magic bytes", () => {
    expect(detectExtFromBytes(makeGif())).toBe(".gif");
  });

  test("returns null for fewer than 4 bytes", () => {
    expect(detectExtFromBytes(new Uint8Array([0x89, 0x50]))).toBe(null);
  });

  test("returns null for random bytes", () => {
    expect(detectExtFromBytes(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe(null);
  });
});
