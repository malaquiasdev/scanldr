import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CliError } from "@plugins/errors/index.ts";
import { createLogger } from "@plugins/logger/index.ts";
import { zipSync } from "fflate";
import { buildVolumeFilename, defaultVolumeName, deleteIndividualFiles, packVolume } from "./pack.ts";
import { runPackPrompts } from "./prompt-pack.ts";

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
// runPackPrompts — unit tests (non-interactive paths only)
// ---------------------------------------------------------------------------

describe("runPackPrompts", () => {
  const baseOpts = {
    slug: "dandadan",
    outputName: "dandadan-volume-103-111.cbz",
    defaultVolumeStem: "103-111",
    checkExists: async () => false,
    nonTty: false,
    packFlag: false,
    packNameProvided: false,
    packReplace: false,
    packOverwrite: false,
    logger,
  };

  test("N == 1 → skip (shouldPack: false)", async () => {
    const result = await runPackPrompts({ ...baseOpts, chapterCount: 1 });
    expect(result).toEqual({ shouldPack: false, shouldDelete: false });
  });

  test("non-TTY without --pack flag → skip", async () => {
    const result = await runPackPrompts({
      ...baseOpts,
      chapterCount: 5,
      nonTty: true,
    });
    expect(result).toEqual({ shouldPack: false, shouldDelete: false });
  });

  test("non-TTY with --pack-replace → pack + delete, no prompt", async () => {
    const result = await runPackPrompts({
      ...baseOpts,
      chapterCount: 5,
      nonTty: true,
      packFlag: true,
      packReplace: true,
    });
    expect(result).toEqual({ shouldPack: true, shouldDelete: true });
  });

  test("non-TTY with --pack flag only → pack, keep individuals", async () => {
    const result = await runPackPrompts({
      ...baseOpts,
      chapterCount: 5,
      nonTty: true,
      packFlag: true,
    });
    expect(result).toEqual({ shouldPack: true, shouldDelete: false });
  });

  test("non-TTY + file exists + no --pack-overwrite → throws CliError", async () => {
    await expect(
      runPackPrompts({
        ...baseOpts,
        chapterCount: 5,
        nonTty: true,
        packFlag: true,
        checkExists: async () => true,
        packOverwrite: false,
      }),
    ).rejects.toThrow(/already exists/i);
  });

  test("non-TTY + file exists + --pack-overwrite → pack succeeds", async () => {
    const result = await runPackPrompts({
      ...baseOpts,
      chapterCount: 5,
      nonTty: true,
      packFlag: true,
      checkExists: async () => true,
      packOverwrite: true,
    });
    expect(result.shouldPack).toBe(true);
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
