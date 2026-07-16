// Pure HTML parsing functions for mangakakalot.gg.
// All cheerio selectors live here as named constants — fix DOM drift in one place.

import type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
import type { ImageRef } from "@integrations/_shared/media.ts";
import * as cheerio from "cheerio";
import {
  MangakakalotParseError,
  type MkChapterApiItem,
  type MkChapterApiResponse,
} from "./types.ts";

const SELECTORS = {
  // Search results page
  searchResultItem: ".story_item",
  searchResultLink: ".story_name a",

  // Chapter reader page — confirmed against real HTML (2026-05-03)
  chapterReaderImage: ".container-chapter-reader img",

  // Structural site markers used to distinguish DOM drift from no-content pages
  siteHeader: "header, .header, .navbar, body",
} as const;

/** Extracts manga slug from a mangakakalot URL like https://www.mangakakalot.gg/manga/some-slug */
function slugFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const mangaIdx = parts.indexOf("manga");
    if (mangaIdx >= 0 && parts[mangaIdx + 1]) return parts[mangaIdx + 1] as string;
    const chapterIdx = parts.indexOf("chapter");
    if (chapterIdx >= 0 && parts[chapterIdx + 1]) return parts[chapterIdx + 1] as string;
    return parts[parts.length - 1] ?? url;
  } catch {
    return url;
  }
}

/**
 * Parses search results from a mangakakalot search page.
 *
 * Returns [] on a genuine "no results" page (search container present but empty).
 * Throws MangakakalotParseError when the search container is absent entirely AND
 * the page contains structural site markup (body tag present) — this indicates DOM
 * drift, not an empty search result set.
 *
 * Heuristic: if `.story_item` root has zero matches AND `<body>` exists with content,
 * the search results container structure has changed.
 */
export function parseSearchResults(html: string, url: string): MangaCandidate[] {
  const $ = cheerio.load(html);
  const results: MangaCandidate[] = [];

  const items = $(SELECTORS.searchResultItem);

  if (items.length === 0) {
    if (isSearchDomDrifted($)) {
      throw new MangakakalotParseError(
        SELECTORS.searchResultItem,
        url,
        "search results container missing from page; DOM may have changed",
      );
    }
    return [];
  }

  items.each((_, el) => {
    const anchor = $(el).find(SELECTORS.searchResultLink).first();
    const href = anchor.attr("href") ?? "";
    const title = anchor.text().trim();
    if (!title || !href) return;

    const id = slugFromUrl(href);
    results.push({ id, title, originalLanguage: "en", year: null });
  });

  return results;
}

/**
 * True when a live page (non-empty body) has no results container at all —
 * distinguishing genuine "no results" (panel present but empty) from DOM drift.
 */
function isSearchDomDrifted($: ReturnType<typeof cheerio.load>): boolean {
  const hasBody = $("body").length > 0 && $("body").text().trim().length > 0;
  const hasResultsPanel =
    $(".panel_story_list").length > 0 ||
    $(".story_item_right").length > 0 ||
    $(".panel-search-story").length > 0;
  return hasBody && !hasResultsPanel;
}

function isMkChapterApiItem(v: unknown): v is MkChapterApiItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.chapter_name === "string" &&
    typeof o.chapter_slug === "string" &&
    typeof o.chapter_num === "number" &&
    typeof o.updated_at === "string"
  );
}

function isMkChapterApiResponse(v: unknown): v is MkChapterApiResponse {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.success !== true) return false;
  if (!o.data || typeof o.data !== "object") return false;
  const data = o.data as Record<string, unknown>;
  return Array.isArray(data.chapters);
}

/**
 * Parses the chapter list from the mangakakalot JSON API response.
 *
 * The API returns chapters newest-first in pages (limit 50 per page).
 * Output is sorted ascending by chapter_num.
 * Throws MangakakalotParseError when the JSON shape is invalid.
 *
 * Returns { chapters, hasMore, limit } so the caller can paginate.
 */
export function parseChapterListFromApi(
  json: unknown,
  mangaSlug: string,
): { chapters: ChapterRef[]; hasMore: boolean; limit: number } {
  if (!isMkChapterApiResponse(json)) {
    throw new MangakakalotParseError(
      "data.chapters",
      `https://www.mangakakalot.gg/api/manga/${mangaSlug}/chapters`,
      "invalid API response shape; expected { success: true, data: { chapters: [...] } }",
    );
  }

  const items = json.data.chapters;
  const chapters: ChapterRef[] = [];

  for (const item of items) {
    if (!isMkChapterApiItem(item)) {
      throw new MangakakalotParseError(
        "data.chapters[*]",
        `https://www.mangakakalot.gg/api/manga/${mangaSlug}/chapters`,
        `chapter item missing required fields: ${JSON.stringify(item)}`,
      );
    }

    // composite id; resolveChapterUrl (client/index.ts) reconstructs SITE_ROOT/manga/<id>
    const id = `${mangaSlug}/${item.chapter_slug}`;

    const rawTitle = item.chapter_name.replace(/^chapter[\s\d.]+[:-]?\s*/i, "").trim();
    const title = rawTitle.length > 0 ? rawTitle : null;

    chapters.push({
      id,
      volume: null,
      chapter: String(item.chapter_num),
      title,
      translatedLanguage: "en",
      scanlationGroup: null,
      readableAt: item.updated_at,
      externalUrl: null,
    });
  }

  // API returns newest-first; sort ascending by chapter_num for caller convenience.
  chapters.sort((a, b) => Number(a.chapter) - Number(b.chapter));

  const pagination = json.data.pagination;
  const hasMore = pagination?.has_more === true;
  const limit = pagination?.limit ?? 50;

  return { chapters, hasMore, limit };
}

// site's own hosts, not the external image CDN (e.g. *.2xstorage.com) real pages use
const SITE_HOSTS = new Set(["mangakakalot.gg", "www.mangakakalot.gg"]);

/**
 * Returns true when the URL looks like a real manga page image.
 *
 * Rejects when ANY of:
 * - URL path contains `/images/bns/`  (banner ad namespace)
 * - URL host is mangakakalot.gg / www.mangakakalot.gg  (site assets, not CDN)
 * - File extension is `.gif`  (manga pages are webp / jpg / jpeg / png)
 */
export function isMangaPageImage(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (SITE_HOSTS.has(parsed.hostname)) return false;
  if (parsed.pathname.includes("/images/bns/")) return false;
  if (parsed.pathname.toLowerCase().endsWith(".gif")) return false;

  return true;
}

/**
 * Parses chapter image URLs from a mangakakalot reader page.
 *
 * Filters out banner ads and non-CDN images via `isMangaPageImage`.
 * Page numbers are sequential starting at 1 based on the filtered list.
 *
 * Throws MangakakalotParseError when zero images remain after filtering.
 * A chapter MUST have at least one image by definition — zero images means the parser broke.
 */
export function parseChapterImages(html: string, url: string): ImageRef[] {
  const $ = cheerio.load(html);
  const images: ImageRef[] = [];
  let pageNum = 0;

  $(SELECTORS.chapterReaderImage).each((_, el) => {
    // Prefer data-src (lazy-loaded canonical URL); fall back to src.
    const imgUrl = $(el).attr("data-src") ?? $(el).attr("src") ?? "";
    if (!imgUrl) return;
    const trimmed = imgUrl.trim();
    if (!isMangaPageImage(trimmed)) return;
    pageNum += 1;
    images.push({ url: trimmed, page: pageNum });
  });

  if (images.length === 0) {
    throw new MangakakalotParseError(
      SELECTORS.chapterReaderImage,
      url,
      "no images found in chapter reader container; DOM may have changed",
    );
  }

  return images;
}
