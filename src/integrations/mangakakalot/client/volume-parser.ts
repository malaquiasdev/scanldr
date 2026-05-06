// Parses the volume→chapter mapping from a mangakakalot manga detail page.
// Chapter names on the manga page follow the pattern "Vol.X Ch.Y [- Optional Title]"
// or just "Chapter N [- Optional Title]" (flat list, no volume labels).

import * as cheerio from "cheerio";
import type { FallbackChapterRef, VolumeMap } from "./types.ts";
import { MangakakalotParseError } from "./types.ts";

// Confirmed selector against real mangakakalot.gg manga pages (2026-05-06).
// Each <li> inside ul.row-content-chapter has an <a class="chapter-name"> with the chapter label.
// Selector confirmed on non-DMCA series (e.g. naruto); DMCA'd series (e.g. dandadan) return
// a manga page with h1/og:title present but the chapter list container absent → drift throw.
const CHAPTER_LIST_SELECTOR = "ul.row-content-chapter li";
const CHAPTER_LINK_SELECTOR = "a.chapter-name";

// Matches "Vol.13 Ch.128 ..." or "Vol.1 Ch.1" — captures volume and chapter numbers.
const VOL_CH_PATTERN = /Vol\.(\d+(?:\.\d+)?)\s+Ch\.(\d+(?:\.\d+)?)/i;

// Matches "Ch.N" or "Chapter N" without a volume prefix.
const CH_ONLY_PATTERN = /(?:Ch\.|Chapter\s+)(\d+(?:\.\d+)?)/i;

/**
 * Heuristic: determines whether a page looks like a real manga detail page.
 *
 * A real manga page has at minimum one of:
 *   - An <h1> element with non-trivial text (the manga title)
 *   - An og:title meta tag
 *   - A .story-info-right container (standard mangakakalot detail page shell)
 *
 * If true, a missing chapter list signals DOM drift or DMCA removal — telemetry-worthy.
 * If false (bare HTML, redirect page, error page), silently returning [] is fine.
 */
function htmlLooksLikeMangaPage($: cheerio.CheerioAPI): boolean {
  if ($("meta[property='og:title']").attr("content")?.trim()) return true;
  if ($(".story-info-right").length > 0) return true;
  const h1Text = $("h1").first().text().trim();
  if (h1Text.length > 2) return true;
  return false;
}

/**
 * Extract chapter slug from a mangakakalot chapter URL.
 * URL form: https://www.mangakakalot.gg/manga/<manga-slug>/<chapter-slug>
 * Returns "<manga-slug>/<chapter-slug>" composite id (matches getChapterImages convention).
 */
function compositeIdFromUrl(href: string): string | null {
  try {
    const parsed = new URL(href);
    const parts = parsed.pathname.split("/").filter(Boolean);
    // Expected: ["manga", "<manga-slug>", "<chapter-slug>"]
    const mangaIdx = parts.indexOf("manga");
    if (mangaIdx >= 0 && parts[mangaIdx + 1] && parts[mangaIdx + 2]) {
      return `${parts[mangaIdx + 1]}/${parts[mangaIdx + 2]}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse the manga detail page HTML and extract volume→chapter mapping.
 *
 * Returns a VolumeMap (array of VolumeBucket).
 * - Chapters with "Vol.X Ch.Y" labels are grouped under volume X.
 * - Chapters without volume labels are grouped under the "unknown" bucket.
 * - Returns [] for genuinely empty / non-manga pages (blank HTML, 404 shells, etc.).
 * - Throws MangakakalotParseError when the page looks like a manga detail page
 *   (has h1/og:title/story-info-right) but the chapter list container is absent —
 *   this signals DOM drift or DMCA chapter removal, not a genuinely empty page.
 *
 * Buckets are sorted by volume number ascending; "unknown" is always last.
 * Chapters within each bucket are sorted by chapter number ascending.
 */
export function parseVolumeMapping(html: string, url = ""): VolumeMap {
  const $ = cheerio.load(html);
  const items = $(CHAPTER_LIST_SELECTOR);

  if (items.length === 0) {
    // Distinguish DOM drift from genuinely empty pages.
    if (htmlLooksLikeMangaPage($)) {
      throw new MangakakalotParseError(
        CHAPTER_LIST_SELECTOR,
        url,
        "no chapter list found on manga detail page; site may have refactored or DMCA'd the chapter list",
      );
    }
    return [];
  }

  // volume string → chapters list
  const buckets = new Map<string, FallbackChapterRef[]>();

  items.each((_, el) => {
    const anchor = $(el).find(CHAPTER_LINK_SELECTOR).first();
    const label = anchor.text().trim();
    const href = anchor.attr("href") ?? "";

    const id = compositeIdFromUrl(href);
    if (!id) return;

    const volChMatch = label.match(VOL_CH_PATTERN);
    if (volChMatch) {
      const volume = String(Number(volChMatch[1])); // normalise "01" → "1"
      const chapter = String(Number(volChMatch[2]));
      const existing = buckets.get(volume) ?? [];
      existing.push({ id, chapter });
      buckets.set(volume, existing);
      return;
    }

    // Flat chapter without volume label — put in "unknown" bucket.
    const chOnlyMatch = label.match(CH_ONLY_PATTERN);
    const chapter = chOnlyMatch ? String(Number(chOnlyMatch[1])) : null;
    const existing = buckets.get("unknown") ?? [];
    existing.push({ id, chapter });
    buckets.set("unknown", existing);
  });

  // Sort buckets: numeric volumes ascending, "unknown" last.
  const sorted: VolumeMap = [];
  const numericKeys = [...buckets.keys()]
    .filter((k) => k !== "unknown")
    .sort((a, b) => Number(a) - Number(b));

  for (const vol of numericKeys) {
    const chapters = (buckets.get(vol) ?? []).sort(
      (a, b) => Number(a.chapter ?? 0) - Number(b.chapter ?? 0),
    );
    sorted.push({ volume: vol, chapters });
  }

  if (buckets.has("unknown")) {
    const chapters = (buckets.get("unknown") ?? []).sort(
      (a, b) => Number(a.chapter ?? 0) - Number(b.chapter ?? 0),
    );
    sorted.push({ volume: "unknown", chapters });
  }

  return sorted;
}
