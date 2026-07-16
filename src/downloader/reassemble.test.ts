import { describe, expect, mock, test } from "bun:test";
import sharp from "sharp";
import { groupTiles, reassembleChapterPages } from "./reassemble.ts";
import type { PageDims, RawPage } from "./types.ts";

/** A tile whose header decodes fine but whose body is truncated, so stitching (full decode
 * via toBuffer) throws mid-way — while metadata() (header-only read) succeeds. */
async function makeCorruptBodyPage(width: number, height: number): Promise<RawPage> {
  const data = await sharp({
    create: { width, height, channels: 3, background: { r: 5, g: 5, b: 5 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  const truncated = data.subarray(0, Math.floor(data.length * 0.3));
  return { data: new Uint8Array(truncated), ext: ".jpg" };
}

async function makePage(
  width: number,
  height: number,
  color: [number, number, number],
): Promise<RawPage> {
  const data = await sharp({
    create: { width, height, channels: 3, background: { r: color[0], g: color[1], b: color[2] } },
  })
    .webp()
    .toBuffer();
  return { data: new Uint8Array(data), ext: ".webp" };
}

describe("groupTiles", () => {
  test("volume-8 profile: 142 exact [1500x1500]+[1500x652] pairs", () => {
    const dims: PageDims[] = [];
    for (let i = 0; i < 142; i++) {
      dims.push({ width: 1500, height: 1500 });
      dims.push({ width: 1500, height: 652 });
    }
    const groups = groupTiles(dims);
    expect(groups.length).toBe(142);
    for (let i = 0; i < 142; i++) {
      expect(groups[i]).toEqual([i * 2, i * 2 + 1]);
    }
  });

  test("standalone short pages (1500x1076) are not merged", () => {
    const dims: PageDims[] = [{ width: 1500, height: 1076 }];
    expect(groupTiles(dims)).toEqual([[0]]);
  });

  test("narrow title cards (~750px wide) are standalone, not merged with adjacent 1500-wide runs", () => {
    const dims: PageDims[] = [
      { width: 750, height: 1076 },
      { width: 1500, height: 1500 },
      { width: 1500, height: 652 },
    ];
    const groups = groupTiles(dims);
    expect(groups).toEqual([[0], [1, 2]]);
  });

  test("mixed chapter profile matches expected grouping (78 tiles -> 40 logical pages)", () => {
    const dims: PageDims[] = [];
    // 38 tiled pairs (76 tiles) + 2 standalone pages = 78 tiles, 40 logical pages.
    for (let i = 0; i < 38; i++) {
      dims.push({ width: 1500, height: 1500 });
      dims.push({ width: 1500, height: 652 });
    }
    dims.push({ width: 1500, height: 1076 });
    dims.push({ width: 750, height: 1076 });

    const groups = groupTiles(dims);
    expect(groups.length).toBe(40);
    expect(groups.slice(0, 38).every((g) => g.length === 2)).toBe(true);
    expect(groups[38]).toEqual([76]);
    expect(groups[39]).toEqual([77]);
  });

  test("real ch-027 profile: 78 tiles (38 pairs + 1076-tall remainder + ~750-wide title card) -> 40 pages", () => {
    // Exact profile from issue #168 AC3: 38 x [1500x1500 + 1500x652] pairs, then a
    // standalone [1500x1076] remainder page, then a narrow ~750-wide title card.
    const dims: PageDims[] = [];
    for (let i = 0; i < 38; i++) {
      dims.push({ width: 1500, height: 1500 });
      dims.push({ width: 1500, height: 652 });
    }
    dims.push({ width: 1500, height: 1076 });
    dims.push({ width: 752, height: 1076 });

    const groups = groupTiles(dims);
    expect(groups.length).toBe(40);
    expect(groups.slice(0, 38).every((g) => g.length === 2)).toBe(true);
    expect(groups[38]).toEqual([76]);
    expect(groups[39]).toEqual([77]);
  });

  test("a cap-height tile with no following remainder in the same run stays its own group", () => {
    // Never observed from the CDN, but must not merge silently / must not crash.
    const dims: PageDims[] = [{ width: 1500, height: 1500 }];
    expect(groupTiles(dims)).toEqual([[0]]);
  });

  test("empty input yields no groups", () => {
    expect(groupTiles([])).toEqual([]);
  });

  test("undecodable dims (null) never merge with neighbors", () => {
    const dims: Array<PageDims | null> = [
      { width: 1500, height: 1500 },
      null,
      { width: 1500, height: 652 },
    ];
    expect(groupTiles(dims)).toEqual([[0], [1], [2]]);
  });
});

describe("reassembleChapterPages", () => {
  test("non-tiled pages pass through byte-identical", async () => {
    const page = await makePage(1500, 1076, [10, 20, 30]);
    const result = await reassembleChapterPages([page]);
    expect(result.length).toBe(1);
    expect(result[0]?.data).toBe(page.data);
    expect(result[0]?.ext).toBe(page.ext);
  });

  test("tiled group is stitched into one taller webp page", async () => {
    const top = await makePage(1500, 1500, [255, 0, 0]);
    const bottom = await makePage(1500, 652, [0, 255, 0]);
    const result = await reassembleChapterPages([top, bottom]);
    expect(result.length).toBe(1);
    const merged = result[0];
    expect(merged?.ext).toBe(".webp");
    const meta = await sharp(merged?.data).metadata();
    expect(meta.width).toBe(1500);
    expect(meta.height).toBe(2152);
  });

  test("chapter with a tiled pair and a standalone page collapses to 2 logical pages", async () => {
    const top = await makePage(1500, 1500, [255, 0, 0]);
    const bottom = await makePage(1500, 652, [0, 255, 0]);
    const standalone = await makePage(1500, 1076, [0, 0, 255]);
    const result = await reassembleChapterPages([top, bottom, standalone]);
    expect(result.length).toBe(2);
    expect(result[1]?.data).toBe(standalone.data);
  });

  test("empty chapter returns empty array", async () => {
    expect(await reassembleChapterPages([])).toEqual([]);
  });

  test("undecodable page bytes pass through byte-identical instead of throwing", async () => {
    const garbage: RawPage = { data: new Uint8Array([1, 2, 3, 4]), ext: ".jpg" };
    const result = await reassembleChapterPages([garbage]);
    expect(result).toEqual([garbage]);
  });

  test("a group that decodes headers OK but fails mid-stitch degrades to original tiles unmerged", async () => {
    const top = await makeCorruptBodyPage(1500, 1500);
    const bottom = await makePage(1500, 652, [0, 255, 0]);
    const warn = mock(() => {});
    const logger = { error: mock(() => {}), warn, info: mock(() => {}) };

    const result = await reassembleChapterPages([top, bottom], logger);

    expect(result).toEqual([top, bottom]);
    expect(warn).toHaveBeenCalledTimes(1);
    const calls = warn.mock.calls as unknown as Array<[Record<string, unknown>, string]>;
    const fields = calls[0]?.[0];
    expect(fields).toMatchObject({
      event: "downloader.tiles_stitch_failed",
      context: "downloader",
      pageIndices: [0, 1],
    });
  });

  test("stitch failure emits the group's tiles unmerged (no throw, bundle continues)", async () => {
    const top = await makeCorruptBodyPage(1500, 1500);
    const bottom = await makePage(1500, 652, [0, 255, 0]);
    const standalone = await makePage(900, 900, [10, 20, 30]);
    const warn = mock(() => {});
    const logger = { error: mock(() => {}), warn, info: mock(() => {}) };

    // No throw across the whole bundle, even though the first group's stitch fails.
    const result = await reassembleChapterPages([top, bottom, standalone], logger);

    // Failed group's tiles pass through unmerged...
    expect(result[0]).toEqual(top);
    expect(result[1]).toEqual(bottom);
    // ...and the bundle continues processing the next (unrelated) group.
    expect(result[2]?.data).toBe(standalone.data);
    expect(result.length).toBe(3);
  });
});
