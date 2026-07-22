import type { Logger } from "@plugins/logger/index.ts";
import sharp from "sharp";
import type { PageDims, RawPage } from "./types.ts";

/**
 * Groups tile indices per the deterministic CDN-tiling rule (see ADR-007 / issue #168):
 *
 * Operate on ONE chapter's tiles in reader order. A group is a maximal run of consecutive
 * tiles sharing the SAME width, where every tile except the last has height == the run's
 * cap (the max tile height observed in that same-width run), and the closing tile has
 * height < cap.
 *
 * - A width change closes the current run and starts a new one.
 * - A sub-cap tile NOT preceded by a cap-height tile of the same width is its own
 *   standalone group (e.g. a standalone short page, or a narrow title card).
 *
 * Known edge (accepted, not fixable from dimensions alone): see ADR-007 for the
 * cap-height-with-no-remainder ambiguity.
 *
 * A `null` entry (dims could not be determined — e.g. an undecodable/malformed image)
 * is always its own standalone group and never merges with a neighbor.
 *
 * Returns an array of index groups (each group is the list of original indices it merges),
 * covering every input index exactly once, in order.
 *
 * Non-null by construction: `findSameWidthRunEnd` only extends the run while
 * `dims[end]?.width === width`, which is never true for a null entry — so the run slice
 * cast to `PageDims[]` below is safe.
 *
 * Any tiles left in a run without a sub-cap closer stand alone (see ADR-007).
 */
export function groupTiles(dims: Array<PageDims | null>): number[][] {
  const groups: number[][] = [];
  let i = 0;

  while (i < dims.length) {
    const entry = dims[i];
    if (entry === null || entry === undefined) {
      groups.push([i]);
      i++;
      continue;
    }
    const end = findSameWidthRunEnd(dims, i);
    const run = dims.slice(i, end) as PageDims[];
    const cap = Math.max(...run.map((d) => d.height));

    const groupStart = splitRunByCap(dims, i, end, cap, groups);
    for (let j = groupStart; j < end; j++) {
      groups.push([j]);
    }

    i = end;
  }

  return groups;
}

// Finds the extent (exclusive end index) of the same-width run starting at `i`.
function findSameWidthRunEnd(dims: Array<PageDims | null>, i: number): number {
  const width = dims[i]?.width;
  let end = i;
  while (end < dims.length && dims[end]?.width === width) {
    end++;
  }
  return end;
}

// Walks the run [i, end), splitting it into groups per the cap rule. Returns the index
// where the trailing (non-closed) portion of the run begins.
function splitRunByCap(
  dims: Array<PageDims | null>,
  i: number,
  end: number,
  cap: number,
  groups: number[][],
): number {
  let groupStart = i;
  for (let j = i; j < end; j++) {
    const height = dims[j]?.height;
    if (height !== undefined && height < cap) {
      groups.push(range(groupStart, j));
      groupStart = j + 1;
    }
  }
  return groupStart;
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let k = start; k <= end; k++) out.push(k);
  return out;
}

/**
 * Reads width/height for each page by decoding just the header via sharp's metadata().
 * Undecodable bytes (not a real image sharp understands) yield `null` so the page is
 * treated as a standalone, untouched page rather than aborting the whole chapter.
 */
async function readDims(pages: RawPage[]): Promise<Array<PageDims | null>> {
  return Promise.all(
    pages.map(async (page) => {
      try {
        const meta = await sharp(page.data).metadata();
        return { width: meta.width ?? 0, height: meta.height ?? 0 };
      } catch {
        return null;
      }
    }),
  );
}

/**
 * Vertically stitches a group of tiles (top to bottom, in order) and re-encodes as webp.
 * Tiles are passed as their original encoded bytes directly into sharp's composite (which
 * accepts encoded buffers) — no per-tile decode/re-encode pass, so pixels only go through
 * one lossy generation (the final webp encode).
 */
async function stitch(pages: RawPage[], dims: PageDims[]): Promise<RawPage> {
  const width = dims[0]?.width ?? 0;
  const totalHeight = dims.reduce((sum, d) => sum + d.height, 0);

  let offsetTop = 0;
  const composites = pages.map((page, i) => {
    const top = offsetTop;
    offsetTop += dims[i]?.height ?? 0;
    return { input: Buffer.from(page.data), top, left: 0 };
  });

  const data = await sharp({
    create: {
      width,
      height: totalHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp()
    .toBuffer();

  return { data: new Uint8Array(data), ext: ".webp" };
}

/**
 * Detects and merges CDN-tiled pages within one chapter's ordered raw pages.
 * Non-tiled pages (group length 1) pass through byte-identical (no re-encode).
 * Tiled groups (length >= 2) are vertically stitched and re-encoded as webp.
 *
 * If stitching a group fails, it degrades gracefully: the group's tiles are emitted
 * unmerged instead, so one bad group doesn't abort the whole chapter's bundle.
 */
export async function reassembleChapterPages(
  pages: RawPage[],
  logger?: Logger,
): Promise<RawPage[]> {
  if (pages.length === 0) return [];

  const dims = await readDims(pages);
  const groups = groupTiles(dims);

  const out: RawPage[] = [];
  for (const group of groups) {
    if (group.length === 1) {
      const idx = group[0];
      const page = idx !== undefined ? pages[idx] : undefined;
      if (page) out.push(page);
      continue;
    }
    const tiles = group.map((idx) => pages[idx]).filter((p): p is RawPage => p !== undefined);
    const tileDims = group
      .map((idx) => dims[idx])
      .filter((d): d is PageDims => d !== null && d !== undefined);
    try {
      out.push(await stitch(tiles, tileDims));
    } catch (err) {
      logger?.warn(
        {
          event: "downloader.tiles_stitch_failed",
          context: "downloader",
          pageIndices: group,
          error: err instanceof Error ? err.message : String(err),
        },
        "failed to stitch tiled page group, emitting tiles unmerged",
      );
      out.push(...tiles);
    }
  }

  return out;
}
