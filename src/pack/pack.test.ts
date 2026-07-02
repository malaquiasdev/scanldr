import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CliError } from "@plugins/errors/index.ts";
import { createLogger } from "@plugins/logger/index.ts";
import { zipSync } from "fflate";
import {
  buildVolumeFilename,
  defaultVolumeName,
  deleteIndividualFiles,
  injectCoverIntoCbz,
  packVolume,
} from "./pack.ts";

const TMP = join(import.meta.dir, "__pack_test_tmp__");
const logger = createLogger({ level: "warn", format: "human" });

/** Build a minimal cbz with N pages (1.jpg, 2.jpg...) and write it to disk. */
async function makeChapterCbz(
  dir: string,
  slug: string,
  num: string,
  pages: number,
): Promise<string> {
  const entries: Record<string, Uint8Array> = {};
  for (let i = 1; i <= pages; i++) {
    // Minimal JPEG header bytes
    entries[`${String(i).padStart(4, "0")}.jpg`] = new Uint8Array([0xff, 0xd8, 0xff, i]);
  }
  const zipped = zipSync(entries);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${slug}-chapter-${num}.cbz`);
  await writeFile(path, zipped);
  return path;
}

// ---------------------------------------------------------------------------
// defaultVolumeName
// ---------------------------------------------------------------------------

describe("defaultVolumeName", () => {
  test("formats first-last range correctly", () => {
    const chapters = [
      { num: "103", outputPath: "" },
      { num: "104", outputPath: "" },
      { num: "105", outputPath: "" },
    ];
    expect(defaultVolumeName("dandadan", chapters)).toBe("dandadan-volume-103-105");
  });

  test("single chapter: no range suffix", () => {
    const chapters = [{ num: "7", outputPath: "" }];
    expect(defaultVolumeName("dandadan", chapters)).toBe("dandadan-volume-007");
  });

  test("decimal chapter pads integer portion", () => {
    const chapters = [
      { num: "18.5", outputPath: "" },
      { num: "19", outputPath: "" },
    ];
    expect(defaultVolumeName("series", chapters)).toBe("series-volume-018.5-019");
  });

  test("'none' sentinel (chapter with no reported number) sorts last and yields a clean filename, never a misleading number", () => {
    const chapters = [
      { num: "103", outputPath: "" },
      { num: "none", outputPath: "" },
    ];
    const name = defaultVolumeName("series", chapters);
    expect(name).toBe("series-volume-103-none");
    expect(name).not.toMatch(/\d{4}/); // never a synthetic 4-digit number like "1001"
  });
});

// ---------------------------------------------------------------------------
// buildVolumeFilename
// ---------------------------------------------------------------------------

describe("buildVolumeFilename", () => {
  test("prompt input '13' produces <slug>-volume-13.cbz filename", () => {
    expect(buildVolumeFilename("dandadan", "13")).toBe("dandadan-volume-13.cbz");
  });

  test("prompt input '13.5' produces <slug>-volume-13.5.cbz filename", () => {
    expect(buildVolumeFilename("dandadan", "13.5")).toBe("dandadan-volume-13.5.cbz");
  });

  test("prompt input 'special-edition' produces <slug>-volume-special-edition.cbz", () => {
    expect(buildVolumeFilename("dandadan", "special-edition")).toBe(
      "dandadan-volume-special-edition.cbz",
    );
  });

  test("prompt input '13.cbz' single-suffixes correctly (no .cbz.cbz)", () => {
    const result = buildVolumeFilename("dandadan", "13.cbz");
    expect(result).toBe("dandadan-volume-13.cbz");
    expect(result).not.toContain(".cbz.cbz");
  });
});

// ---------------------------------------------------------------------------
// packVolume — fixture-based integration tests
// ---------------------------------------------------------------------------

describe("packVolume", () => {
  async function setup() {
    const dir = join(TMP, String(Math.random()));
    const slug = "dandadan";
    const slug_dir = join(dir, slug);

    const ch103 = await makeChapterCbz(slug_dir, slug, "103", 10);
    const ch104 = await makeChapterCbz(slug_dir, slug, "104", 8);
    const ch105 = await makeChapterCbz(slug_dir, slug, "105", 12);

    return {
      dir,
      slug,
      chapters: [
        { num: "103", outputPath: ch103 },
        { num: "104", outputPath: ch104 },
        { num: "105", outputPath: ch105 },
      ],
    };
  }

  test("total image count equals sum of page counts", async () => {
    const { dir, slug, chapters } = await setup();
    const result = await packVolume({ slug, outDir: dir, chapters, logger });

    const raw = await Bun.file(result.outputPath).arrayBuffer();
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(raw));
    const names = Object.keys(entries);

    expect(names.length).toBe(10 + 8 + 12); // 30 total

    await rm(dir, { recursive: true, force: true });
  });

  test("ordering: first entry is chapter-103/page-001, last is chapter-105/page-012", async () => {
    const { dir, slug, chapters } = await setup();
    const result = await packVolume({ slug, outDir: dir, chapters, logger });

    const raw = await Bun.file(result.outputPath).arrayBuffer();
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(raw));
    const names = Object.keys(entries).sort();

    expect(names[0]).toBe("chapter-103/page-001.jpg");
    expect(names[names.length - 1]).toBe("chapter-105/page-012.jpg");

    await rm(dir, { recursive: true, force: true });
  });

  test("decimal chapters: prefix is chapter-018.5", async () => {
    const dir = join(TMP, String(Math.random()));
    const slug = "series";
    const slug_dir = join(dir, slug);

    const ch18_5 = await makeChapterCbz(slug_dir, slug, "018.5", 3);
    const ch19 = await makeChapterCbz(slug_dir, slug, "019", 3);

    const result = await packVolume({
      slug,
      outDir: dir,
      chapters: [
        { num: "18.5", outputPath: ch18_5 },
        { num: "19", outputPath: ch19 },
      ],
      logger,
    });

    const raw = await Bun.file(result.outputPath).arrayBuffer();
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(raw));
    const names = Object.keys(entries).sort();

    expect(names.some((n) => n.startsWith("chapter-018.5/"))).toBe(true);
    expect(names.some((n) => n.startsWith("chapter-019/"))).toBe(true);

    await rm(dir, { recursive: true, force: true });
  });

  test("chapter with 'none' sentinel num produces chapter-none/ prefix, not a misleading synthetic number", async () => {
    const dir = join(TMP, String(Math.random()));
    const slug = "series";
    const slug_dir = join(dir, slug);

    const chOneshot = await makeChapterCbz(slug_dir, slug, "none", 4);

    const result = await packVolume({
      slug,
      outDir: dir,
      chapters: [{ num: "none", outputPath: chOneshot }],
      logger,
    });

    expect(result.outputPath).toMatch(/series-volume-none\.cbz$/);

    const raw = await Bun.file(result.outputPath).arrayBuffer();
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(raw));
    const names = Object.keys(entries);

    expect(names.every((n) => n.startsWith("chapter-none/"))).toBe(true);
    // Never a synthetic 4-digit chapter number derived from index/bucket math.
    expect(names.some((n) => /chapter-\d{4}/.test(n))).toBe(false);

    await rm(dir, { recursive: true, force: true });
  });

  test("multiple 'none-N' chapters in the same volume produce distinct zip prefixes and lose no pages", async () => {
    const dir = join(TMP, String(Math.random()));
    const slug = "series";
    const slug_dir = join(dir, slug);

    const chA = await makeChapterCbz(slug_dir, slug, "none-1", 3);
    const chB = await makeChapterCbz(slug_dir, slug, "none-2", 5);
    const chC = await makeChapterCbz(slug_dir, slug, "none-3", 2);

    const result = await packVolume({
      slug,
      outDir: dir,
      chapters: [
        { num: "none-1", outputPath: chA },
        { num: "none-2", outputPath: chB },
        { num: "none-3", outputPath: chC },
      ],
      logger,
    });

    const raw = await Bun.file(result.outputPath).arrayBuffer();
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(raw));
    const names = Object.keys(entries);

    const prefixes = new Set(names.map((n) => n.split("/")[0]));
    expect(prefixes).toEqual(new Set(["chapter-none-1", "chapter-none-2", "chapter-none-3"]));
    // No page-loss: total entries == sum of all chapters' pages (3 + 5 + 2).
    expect(names).toHaveLength(10);

    await rm(dir, { recursive: true, force: true });
  });

  test("mixed numbered + multiple 'none-N' chapters sort numbers first (in order), nulls last (mutually stable), no collision", async () => {
    const dir = join(TMP, String(Math.random()));
    const slug = "series";
    const slug_dir = join(dir, slug);

    const ch1 = await makeChapterCbz(slug_dir, slug, "1", 2);
    const chNoneA = await makeChapterCbz(slug_dir, slug, "none-1", 2);
    const ch3 = await makeChapterCbz(slug_dir, slug, "3", 2);
    const chNoneB = await makeChapterCbz(slug_dir, slug, "none-2", 2);

    // Deliberately shuffled input order — packVolume must sort it.
    const result = await packVolume({
      slug,
      outDir: dir,
      chapters: [
        { num: "none-1", outputPath: chNoneA },
        { num: "3", outputPath: ch3 },
        { num: "none-2", outputPath: chNoneB },
        { num: "1", outputPath: ch1 },
      ],
      logger,
    });

    const raw = await Bun.file(result.outputPath).arrayBuffer();
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(raw));
    const names = Object.keys(entries);

    const prefixes = new Set(names.map((n) => n.split("/")[0]));
    expect(prefixes).toEqual(
      new Set(["chapter-001", "chapter-003", "chapter-none-1", "chapter-none-2"]),
    );
    expect(names).toHaveLength(8);

    await rm(dir, { recursive: true, force: true });
  });

  test("collision guard: duplicate zip prefix throws instead of silently overwriting pages", async () => {
    const dir = join(TMP, String(Math.random()));
    const slug = "series";
    const slug_dir = join(dir, slug);

    // Two chapters incorrectly sharing the same num (simulates an upstream
    // disambiguation bug) — packVolume must fail loudly, not silently drop pages.
    // Source cbz files live at distinct paths; only the packed `num` collides.
    const chA = await makeChapterCbz(slug_dir, `${slug}-a`, "none-dup", 3);
    const chB = await makeChapterCbz(slug_dir, `${slug}-b`, "none-dup", 3);

    await expect(
      packVolume({
        slug,
        outDir: dir,
        chapters: [
          { num: "none-dup", outputPath: chA },
          { num: "none-dup", outputPath: chB },
        ],
        logger,
      }),
    ).rejects.toThrow(/duplicate zip entry/i);

    await rm(dir, { recursive: true, force: true });
  });

  test("custom name is respected and .cbz is appended if missing", async () => {
    const { dir, slug, chapters } = await setup();
    const result = await packVolume({
      slug,
      outDir: dir,
      chapters,
      customName: "my-custom-volume",
      logger,
    });

    expect(result.outputPath).toMatch(/my-custom-volume\.cbz$/);

    await rm(dir, { recursive: true, force: true });
  });

  test("cover option: 00_cover.jpg is the first alphabetical entry", async () => {
    const { dir, slug, chapters } = await setup();
    const coverBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const result = await packVolume({
      slug,
      outDir: dir,
      chapters,
      cover: { bytes: coverBytes, ext: ".jpg" },
      logger,
    });

    const raw = await Bun.file(result.outputPath).arrayBuffer();
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(raw));
    const names = Object.keys(entries).sort();

    expect(names[0]).toBe("00_cover.jpg");
    // Total = cover + 30 chapter pages
    expect(names.length).toBe(31);

    await rm(dir, { recursive: true, force: true });
  });

  test("00_cover is the first entry in zip insertion order (not just sorted)", async () => {
    const { dir, slug, chapters } = await setup();
    const coverBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const result = await packVolume({
      slug,
      outDir: dir,
      chapters,
      cover: { bytes: coverBytes, ext: ".jpg" },
      logger,
    });

    const raw = await Bun.file(result.outputPath).arrayBuffer();
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(raw));

    // Assert insertion-order position-0 BEFORE any sort
    expect(Object.keys(entries)[0]).toBe("00_cover.jpg");

    await rm(dir, { recursive: true, force: true });
  });

  test("cover option: cover bytes are preserved exactly", async () => {
    const { dir, slug, chapters } = await setup();
    const coverBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xca, 0xfe]);
    const result = await packVolume({
      slug,
      outDir: dir,
      chapters,
      cover: { bytes: coverBytes, ext: ".jpg" },
      logger,
    });

    const raw = await Bun.file(result.outputPath).arrayBuffer();
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(raw));

    expect(entries["00_cover.jpg"]).toEqual(coverBytes);

    await rm(dir, { recursive: true, force: true });
  });

  test("no cover option: total count unchanged (no extra entries)", async () => {
    const { dir, slug, chapters } = await setup();
    const result = await packVolume({ slug, outDir: dir, chapters, logger });

    const raw = await Bun.file(result.outputPath).arrayBuffer();
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(raw));
    const names = Object.keys(entries);

    // No cover file — should not contain 00_cover
    expect(names.some((n) => n.startsWith("00_cover"))).toBe(false);
    expect(names.length).toBe(30);

    await rm(dir, { recursive: true, force: true });
  });

  test("deleteIndividualFiles removes chapter files", async () => {
    const { dir, chapters } = await setup();

    // Ensure files exist before deletion
    for (const ch of chapters) {
      expect(await Bun.file(ch.outputPath).exists()).toBe(true);
    }

    await deleteIndividualFiles(chapters, logger);

    for (const ch of chapters) {
      expect(await Bun.file(ch.outputPath).exists()).toBe(false);
    }

    await rm(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// packVolume — path traversal rejection (P2.1)
// ---------------------------------------------------------------------------

describe("packVolume — customName path traversal rejection", () => {
  async function setupMinimal() {
    const dir = join(TMP, String(Math.random()));
    const slug = "test";
    const slug_dir = join(dir, slug);
    const ch1 = await makeChapterCbz(slug_dir, slug, "1", 1);
    return { dir, slug, chapters: [{ num: "1", outputPath: ch1 }] };
  }

  test('--pack "../oops" is rejected with CliError', async () => {
    const { dir, slug, chapters } = await setupMinimal();
    await expect(
      packVolume({ slug, outDir: dir, chapters, customName: "../oops", logger }),
    ).rejects.toBeInstanceOf(CliError);
    await rm(dir, { recursive: true, force: true });
  });

  test('--pack "foo/bar" is rejected with CliError', async () => {
    const { dir, slug, chapters } = await setupMinimal();
    await expect(
      packVolume({ slug, outDir: dir, chapters, customName: "foo/bar", logger }),
    ).rejects.toBeInstanceOf(CliError);
    await rm(dir, { recursive: true, force: true });
  });

  test('--pack "..\\\\evil" is rejected with CliError', async () => {
    const { dir, slug, chapters } = await setupMinimal();
    await expect(
      packVolume({ slug, outDir: dir, chapters, customName: "..\\evil", logger }),
    ).rejects.toBeInstanceOf(CliError);
    await rm(dir, { recursive: true, force: true });
  });

  test('--pack "valid-name_1.0 extra" is accepted', async () => {
    const { dir, slug, chapters } = await setupMinimal();
    const result = await packVolume({
      slug,
      outDir: dir,
      chapters,
      customName: "valid-name_1.0 extra",
      logger,
    });
    expect(result.outputPath).toMatch(/valid-name_1\.0 extra\.cbz$/);
    await rm(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// packVolume — custom name already ending in .cbz does not double-append (P2.3)
// ---------------------------------------------------------------------------

describe("packVolume — .cbz suffix deduplication", () => {
  test("--pack <name>.cbz does not double-append .cbz", async () => {
    const dir = join(TMP, String(Math.random()));
    const slug = "dandadan";
    const slug_dir = join(dir, slug);
    const ch1 = await makeChapterCbz(slug_dir, slug, "1", 2);

    const result = await packVolume({
      slug,
      outDir: dir,
      chapters: [{ num: "1", outputPath: ch1 }],
      customName: "my-volume.cbz",
      logger,
    });

    expect(result.outputPath).toMatch(/my-volume\.cbz$/);
    expect(result.outputPath).not.toMatch(/my-volume\.cbz\.cbz$/);

    await rm(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// packVolume — .tmp cleanup on write failure (P2.2)
// ---------------------------------------------------------------------------

describe("packVolume — .tmp cleanup on write failure", () => {
  test("write fails (read-only dir) → .tmp file does NOT exist after", async () => {
    const dir = join(TMP, String(Math.random()));
    const slug = "dandadan";
    const slug_dir = join(dir, slug);
    const ch1 = await makeChapterCbz(slug_dir, slug, "1", 2);

    // Make the output dir read-only so writeFile on .tmp throws
    const { chmod } = await import("node:fs/promises");
    await chmod(slug_dir, 0o555);

    const finalPath = join(slug_dir, "dandadan-volume-001.cbz");
    const tempPath = `${finalPath}.tmp`;

    try {
      await expect(
        packVolume({ slug, outDir: dir, chapters: [{ num: "1", outputPath: ch1 }], logger }),
      ).rejects.toThrow();

      // The .tmp file must NOT be left on disk
      expect(await Bun.file(tempPath).exists()).toBe(false);
    } finally {
      await chmod(slug_dir, 0o755);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// deleteIndividualFiles — partial unlink failure (P2.2)
// ---------------------------------------------------------------------------

describe("deleteIndividualFiles — partial unlink failure", () => {
  test("unlink failure on middle file is logged as warn and does not throw", async () => {
    const dir = join(TMP, String(Math.random()));
    const slug = "dandadan";
    const slug_dir = join(dir, slug);
    await mkdir(slug_dir, { recursive: true });

    // Create 3 real files
    const paths = await Promise.all([
      makeChapterCbz(slug_dir, slug, "1", 1),
      makeChapterCbz(slug_dir, slug, "2", 1),
      makeChapterCbz(slug_dir, slug, "3", 1),
    ]);

    const chapters = paths.map((p, i) => ({ num: String(i + 1), outputPath: p }));

    // Delete the middle file first so unlink will fail on it
    await rm(paths[1] as string, { force: true });

    const warnEvents: string[] = [];
    const spyLogger = {
      info: () => {},
      warn: (obj: unknown) => {
        if (typeof obj === "object" && obj !== null && "event" in obj) {
          warnEvents.push((obj as Record<string, unknown>).event as string);
        }
      },
      error: () => {},
    };

    // Should not throw even though middle file is missing
    await expect(deleteIndividualFiles(chapters, spyLogger)).resolves.toBeUndefined();

    // Outer files should be gone
    expect(await Bun.file(paths[0] as string).exists()).toBe(false);
    expect(await Bun.file(paths[2] as string).exists()).toBe(false);

    // Warn fired for the missing middle file
    expect(warnEvents).toContain("pack.delete_failed");

    await rm(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// injectCoverIntoCbz
// ---------------------------------------------------------------------------

describe("injectCoverIntoCbz", () => {
  async function createTestCbz(
    dir: string,
    filename: string,
    files: Record<string, string>,
  ): Promise<string> {
    const entries: Record<string, Uint8Array> = {};
    for (const [name, content] of Object.entries(files)) {
      entries[name] = new TextEncoder().encode(content);
    }
    const zipped = zipSync(entries);
    await mkdir(dir, { recursive: true });
    const path = join(dir, filename);
    await writeFile(path, zipped);
    return path;
  }

  test("creates 00_cover<ext> as first entry alphabetically and in insertion order", async () => {
    const dir = join(TMP, String(Math.random()));
    const cbzPath = await createTestCbz(dir, "volume.cbz", {
      "chapter-001/page-001.jpg": "page1",
      "chapter-001/page-002.jpg": "page2",
    });

    const coverBytes = new TextEncoder().encode("cover-data");
    await injectCoverIntoCbz(cbzPath, { bytes: coverBytes, ext: ".png" });

    const raw = await Bun.file(cbzPath).arrayBuffer();
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(raw));
    const names = Object.keys(entries);

    // First in insertion order and alphabetically
    expect(names[0]).toBe("00_cover.png");
    expect([...names].sort()[0]).toBe("00_cover.png");

    await rm(dir, { recursive: true, force: true });
  });

  test("chapter entries are preserved after injection", async () => {
    const dir = join(TMP, String(Math.random()));
    const cbzPath = await createTestCbz(dir, "volume.cbz", {
      "chapter-001/page-001.jpg": "page1",
      "chapter-001/page-002.jpg": "page2",
    });

    const coverBytes = new TextEncoder().encode("cover-data");
    await injectCoverIntoCbz(cbzPath, { bytes: coverBytes, ext: ".jpg" });

    const raw = await Bun.file(cbzPath).arrayBuffer();
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(raw));

    expect(new TextDecoder().decode(entries["chapter-001/page-001.jpg"])).toBe("page1");
    expect(new TextDecoder().decode(entries["chapter-001/page-002.jpg"])).toBe("page2");
    expect(new TextDecoder().decode(entries["00_cover.jpg"])).toBe("cover-data");

    await rm(dir, { recursive: true, force: true });
  });

  test("replacing an existing cover (idempotent)", async () => {
    const dir = join(TMP, String(Math.random()));
    const cbzPath = await createTestCbz(dir, "volume.cbz", {
      "00_cover.jpg": "old-cover",
      "chapter-001/page-001.jpg": "page1",
    });

    const coverBytes = new TextEncoder().encode("new-cover");
    await injectCoverIntoCbz(cbzPath, { bytes: coverBytes, ext: ".png" });

    const raw = await Bun.file(cbzPath).arrayBuffer();
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(raw));
    const names = Object.keys(entries);

    expect(names.length).toBe(2);
    expect(names).not.toContain("00_cover.jpg");
    expect(names).toContain("00_cover.png");
    expect(new TextDecoder().decode(entries["00_cover.png"])).toBe("new-cover");
    expect(new TextDecoder().decode(entries["chapter-001/page-001.jpg"])).toBe("page1");

    await rm(dir, { recursive: true, force: true });
  });

  test("multi-chapter integrity: inject cover, all original entries survive byte-for-byte", async () => {
    const dir = join(TMP, String(Math.random()));
    const originalEntries: Record<string, string> = {
      "chapter-001/page-001.jpg": "ch1-p1-data-bytes-etc",
      "chapter-001/page-002.jpg": "ch1-p2-data-bytes-etc",
      "chapter-002/page-001.jpg": "ch2-p1-data-bytes-etc",
      "chapter-002/page-002.jpg": "ch2-p2-data-bytes-etc",
      "chapter-003/page-001.jpg": "ch3-p1-data-bytes-etc",
      "chapter-003/page-002.jpg": "ch3-p2-data-bytes-etc",
    };
    const cbzPath = await createTestCbz(dir, "volume.cbz", originalEntries);

    const coverBytes = new TextEncoder().encode("new-cover-bytes");
    await injectCoverIntoCbz(cbzPath, { bytes: coverBytes, ext: ".jpg" });

    const raw = await Bun.file(cbzPath).arrayBuffer();
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(raw));
    const names = Object.keys(entries);

    // 00_cover sorts first in insertion order and alphabetically
    expect(names[0]).toBe("00_cover.jpg");
    expect([...names].sort()[0]).toBe("00_cover.jpg");

    // Check that every original entry still exists and is byte-for-byte identical
    for (const [name, expectedContent] of Object.entries(originalEntries)) {
      expect(entries[name]).toBeDefined();
      const actualContent = new TextDecoder().decode(entries[name]);
      expect(actualContent).toBe(expectedContent);
    }

    // Check the exact set of entry names (original entries + the new cover)
    const expectedNames = ["00_cover.jpg", ...Object.keys(originalEntries)];
    expect(new Set(names)).toEqual(new Set(expectedNames));
    expect(names.length).toBe(expectedNames.length);

    await rm(dir, { recursive: true, force: true });
  });

  test("atomicity: write fails (read-only dir) → original CBZ intact and no .tmp left", async () => {
    const dir = join(TMP, String(Math.random()));
    const cbzPath = await createTestCbz(dir, "volume.cbz", {
      "chapter-001/page-001.jpg": "page1",
    });

    const originalBytes = await Bun.file(cbzPath).bytes();

    const { chmod } = await import("node:fs/promises");
    await chmod(dir, 0o555);

    const tempPath = `${cbzPath}.tmp`;
    const coverBytes = new TextEncoder().encode("cover-data");

    try {
      await expect(
        injectCoverIntoCbz(cbzPath, { bytes: coverBytes, ext: ".png" }),
      ).rejects.toThrow();

      // The original CBZ must be left byte-for-byte intact
      const currentBytes = await Bun.file(cbzPath).bytes();
      expect(currentBytes).toEqual(originalBytes);

      // The .tmp file must NOT be left on disk
      expect(await Bun.file(tempPath).exists()).toBe(false);
    } finally {
      await chmod(dir, 0o755);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
