// Parses the volume→chapter mapping from a mangakakalot manga detail page.
// Chapter names on the manga page follow the pattern "Vol.X Ch.Y [- Optional Title]"
// or just "Chapter N [- Optional Title]" (flat list, no volume labels).

import * as cheerio from "cheerio";
import type { FallbackChapterRef, VolumeMap } from "./types.ts";

// Confirmed selector against real mangakakalot.gg manga pages (2026-05-06).
// Each <li> inside .row-content-chapter has an <a class="chapter-name"> with the chapter label.
const CHAPTER_LIST_SELECTOR = ".row-content-chapter li";
const CHAPTER_LINK_SELECTOR = "a.chapter-name";

// Matches "Vol.13 Ch.128 ..." or "Vol.1 Ch.1" — captures volume and chapter numbers.
const VOL_CH_PATTERN = /Vol\.(\d+(?:\.\d+)?)\s+Ch\.(\d+(?:\.\d+)?)/i;

// Matches "Ch.N" or "Chapter N" without a volume prefix.
const CH_ONLY_PATTERN = /(?:Ch\.|Chapter\s+)(\d+(?:\.\d+)?)/i;

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
 * - Empty array when the chapter list container is absent (DOM drift).
 *
 * Buckets are sorted by volume number ascending; "unknown" is always last.
 * Chapters within each bucket are sorted by chapter number ascending.
 */
export function parseVolumeMapping(html: string): VolumeMap {
  const $ = cheerio.load(html);
  const items = $(CHAPTER_LIST_SELECTOR);

  if (items.length === 0) {
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
