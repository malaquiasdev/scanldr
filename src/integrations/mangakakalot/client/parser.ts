// Pure HTML parsing functions for mangakakalot.gg.
// All cheerio selectors live here as named constants — fix DOM drift in one place.

import type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
import type { ImageRef } from "@modules/downloader/types.ts";
import * as cheerio from "cheerio";
import { MangakakalotParseError } from "./types.ts";

const SELECTORS = {
  // Search results page
  searchResultItem: ".story_item",
  searchResultTitle: ".story_name a",
  searchResultLink: ".story_name a",

  // Manga detail page
  mangaPageTitle: ".manga-info-text h1",
  mangaPageChapterRow: ".chapter-list .row",
  mangaPageChapterLink: "a",
  mangaPageChapterDate: "span[title]",
  mangaPageNextPage:
    ".panel_page_number .page_select a.page_last, .panel_page_number a.page_select",

  // Chapter reader page
  chapterReaderImage: ".container-chapter-reader img",

  // Structural site markers used to distinguish DOM drift from no-content pages
  siteHeader: "header, .header, .navbar, body",
  paginationPanel: ".panel_page_number",
} as const;

/** Extracts manga slug from a mangakakalot URL like https://mangakakalot.gg/manga/some-slug */
function slugFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    // /manga/<slug> or /chapter/<slug>/chapter-N
    const mangaIdx = parts.indexOf("manga");
    if (mangaIdx >= 0 && parts[mangaIdx + 1]) return parts[mangaIdx + 1] as string;
    // For chapter URLs: /chapter/<manga-slug>/chapter-N
    const chapterIdx = parts.indexOf("chapter");
    if (chapterIdx >= 0 && parts[chapterIdx + 1]) return parts[chapterIdx + 1] as string;
    return parts[parts.length - 1] ?? url;
  } catch {
    return url;
  }
}

/** Parses chapter number from link text like "Chapter 1.5 : Some Title" or from URL path. */
function parseChapterNumber(text: string, href: string): string {
  // Try URL first: /chapter/<manga>/chapter-1.5
  const urlMatch = href.match(/chapter-(\d+(?:\.\d+)?)/i);
  if (urlMatch?.[1]) return urlMatch[1];
  // Try text: "Chapter 1.5" or "Vol.3 Chapter 1.5"
  const textMatch = text.match(/chapter[\s:]+(\d+(?:\.\d+)?)/i);
  if (textMatch?.[1]) return textMatch[1];
  return "0";
}

/** Strips the leading chapter number/label from link text to get the chapter title. */
function parseChapterTitle(text: string): string | null {
  // "Chapter 1 : Some Title" → "Some Title"
  const m = text.match(/chapter[\s\d.]+[:\-]?\s*(.+)/i);
  const candidate = m?.[1]?.trim() ?? null;
  return candidate && candidate.length > 0 ? candidate : null;
}

/**
 * Parses upload date from a span[title] attribute.
 * Attribute may be "Dec 25, 2023 00:00" or just a date.
 * Returns ISO string (UTC). Falls back to epoch if unparseable.
 */
function parseUploadDate(raw: string | undefined): string {
  if (!raw) return new Date(0).toISOString();
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return new Date(0).toISOString();
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
export function parseSearchResults(html: string, url = ""): MangaCandidate[] {
  const $ = cheerio.load(html);
  const results: MangaCandidate[] = [];

  const items = $(SELECTORS.searchResultItem);

  // Distinguish "no results" (panel_story_list present but empty) from "DOM changed"
  // (neither .story_item nor any results panel can be found in a page that has a body).
  if (items.length === 0) {
    const hasBody = $("body").length > 0 && $("body").text().trim().length > 0;
    const hasResultsPanel =
      $(".panel_story_list").length > 0 ||
      $(".story_item_right").length > 0 ||
      $(".panel-search-story").length > 0;

    // If there's a live page (non-empty body) but no results container at all, DOM drifted.
    if (hasBody && !hasResultsPanel) {
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
 * Parses the chapter list from a manga detail page.
 *
 * A manga with one chapter row is valid (return it).
 * An empty chapter list root with a present title is valid (manga exists, no releases yet).
 *
 * Throws MangakakalotParseError only when BOTH the chapter list root AND the manga title
 * selector are missing — two missing selectors is a reliable signal of DOM drift.
 */
export function parseChapterList(html: string, mangaSlug: string, url = ""): ChapterRef[] {
  const $ = cheerio.load(html);
  const chapters: ChapterRef[] = [];

  const chapterRows = $(SELECTORS.mangaPageChapterRow);
  const titleEl = $(SELECTORS.mangaPageTitle);

  // Both selectors missing → DOM changed, not an empty chapter list.
  if (chapterRows.length === 0 && titleEl.length === 0) {
    throw new MangakakalotParseError(
      `${SELECTORS.mangaPageChapterRow}, ${SELECTORS.mangaPageTitle}`,
      url,
      "neither chapter list nor manga title found on page; DOM may have changed",
    );
  }

  chapterRows.each((_, el) => {
    const anchor = $(el).find(SELECTORS.mangaPageChapterLink).first();
    const href = anchor.attr("href") ?? "";
    const text = anchor.text().trim();
    const dateSpan = $(el).find(SELECTORS.mangaPageChapterDate).first();
    const rawDate = dateSpan.attr("title") ?? dateSpan.text().trim();

    if (!href) return;

    // Use the chapter-specific slug from URL as the id to keep it unique.
    // e.g. https://mangakakalot.gg/chapter/manga-slug/chapter-1 → "chapter/manga-slug/chapter-1"
    let id: string;
    try {
      const parsed = new URL(href);
      id = parsed.pathname.replace(/^\//, "");
    } catch {
      id = href;
    }

    const chapterNum = parseChapterNumber(text, href);
    const title = parseChapterTitle(text);
    const readableAt = parseUploadDate(rawDate);

    chapters.push({
      id,
      volume: null,
      chapter: chapterNum,
      title,
      translatedLanguage: "en",
      scanlationGroup: null,
      readableAt,
      externalUrl: null,
    });

    void mangaSlug; // available if needed for future logging; not used in output
  });

  return chapters;
}

/**
 * Parses chapter image URLs from a mangakakalot reader page.
 *
 * Throws MangakakalotParseError when zero images are found inside the reader container.
 * A chapter MUST have at least one image by definition — zero images means the parser broke.
 */
export function parseChapterImages(html: string, url = ""): ImageRef[] {
  const $ = cheerio.load(html);
  const images: ImageRef[] = [];

  $(SELECTORS.chapterReaderImage).each((i, el) => {
    // Prefer data-src (lazy-loaded canonical URL); fall back to src.
    const imgUrl = $(el).attr("data-src") ?? $(el).attr("src") ?? "";
    if (!imgUrl) return;
    images.push({ url: imgUrl.trim(), page: i + 1 });
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

/**
 * Returns the URL of the next chapter-list page, or null if this is the last page.
 * Mangakakalot uses a pagination panel with numbered page links and marks the active
 * page with class `page_select`.
 *
 * Algorithm: iterate anchors in order; once we see the active (page_select) anchor,
 * the very next anchor with an href is the next page. Returns null if no next anchor
 * follows — normal for the last page.
 *
 * DOM shape reference: tests/fixtures/mangakakalot/manga-paginated.html
 * Active page anchor comes first, immediately followed by the next-page anchor.
 */
export function parseChapterListPagination(html: string): string | null {
  const $ = cheerio.load(html);

  const pagePanel = $(".panel_page_number");
  if (pagePanel.length === 0) return null;

  // We check foundActive BEFORE setting it so that we capture the anchor
  // that comes AFTER the active one (not the active anchor itself).
  let foundActive = false;
  let nextUrl: string | null = null;

  pagePanel.find("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (foundActive && !nextUrl) {
      nextUrl = href;
    }
    if ($(el).hasClass("page_select")) {
      foundActive = true;
    }
  });

  return nextUrl;
}
