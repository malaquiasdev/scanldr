// Pure HTML parsing functions for mangakakalot.gg.
// All cheerio selectors live here as named constants — fix DOM drift in one place.

import type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
import type { ImageRef } from "@modules/downloader/types.ts";
import * as cheerio from "cheerio";

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

export function parseSearchResults(html: string): MangaCandidate[] {
  const $ = cheerio.load(html);
  const results: MangaCandidate[] = [];

  $(SELECTORS.searchResultItem).each((_, el) => {
    const anchor = $(el).find(SELECTORS.searchResultLink).first();
    const href = anchor.attr("href") ?? "";
    const title = anchor.text().trim();
    if (!title || !href) return;

    const id = slugFromUrl(href);
    results.push({ id, title, originalLanguage: "en", year: null });
  });

  return results;
}

export function parseChapterList(html: string, mangaSlug: string): ChapterRef[] {
  const $ = cheerio.load(html);
  const chapters: ChapterRef[] = [];

  $(SELECTORS.mangaPageChapterRow).each((_, el) => {
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

export function parseChapterImages(html: string): ImageRef[] {
  const $ = cheerio.load(html);
  const images: ImageRef[] = [];

  $(SELECTORS.chapterReaderImage).each((i, el) => {
    // Prefer data-src (lazy-loaded canonical URL); fall back to src.
    const url = $(el).attr("data-src") ?? $(el).attr("src") ?? "";
    if (!url) return;
    images.push({ url: url.trim(), page: i + 1 });
  });

  return images;
}

/**
 * Returns the URL of the next chapter-list page, or null if this is the last page.
 * Mangakakalot uses a pagination panel with "Last" link pointing to the final page
 * and numbered page links. We look for the next sequential page link.
 */
export function parseChapterListPagination(html: string): string | null {
  const $ = cheerio.load(html);

  // Find active page and check if there's a next one.
  // The pagination panel has .page_select for active and numbered links around it.
  const pagePanel = $(".panel_page_number");
  if (pagePanel.length === 0) return null;

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
