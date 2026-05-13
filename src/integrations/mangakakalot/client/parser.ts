// Pure HTML parsing functions for mangakakalot.gg.
// All cheerio selectors live here as named constants — fix DOM drift in one place.

import type { ChapterRef, MangaCandidate } from "@integrations/_shared/manga.ts";
import type { ImageRef } from "@modules/downloader/types.ts";
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

    // id is a composite URL-path segment: "<mangaSlug>/<chapter-slug>"
    // getChapterImages receives this and reconstructs the reader URL as
    //   SITE_ROOT/manga/<mangaSlug>/<chapter-slug>
    const id = `${mangaSlug}/${item.chapter_slug}`;

    // Strip the leading "Chapter NUM" label if present, leaving only the subtitle.
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

/**
 * Detects the client-side chapter-list API placeholder in a manga detail page HTML.
 *
 * mangakakalot.gg has migrated some series (e.g. naruto) to a placeholder div:
 *   <div id="chapter-list-container" data-comic-slug="X" data-api-url="Y">Loading...</div>
 *
 * When present, the chapter list must be fetched from the API endpoint instead of
 * parsed from the HTML. Returns { slug } when the placeholder is well-formed,
 * or null otherwise.
 *
 * Slug must come from data-comic-slug (data-api-url contains "__SLUG__" template).
 */
export function detectChapterApiPlaceholder(html: string): { slug: string } | null {
  const $ = cheerio.load(html);
  const container = $("#chapter-list-container");
  if (container.length === 0) return null;

  const apiUrl = container.attr("data-api-url")?.trim() ?? "";
  const slug = container.attr("data-comic-slug")?.trim() ?? "";

  if (!apiUrl || !slug) return null;

  return { slug };
}

// Banner ads live under /images/bns/ on the mangakakalot.gg host.
// Real chapter pages come from image CDN hosts (e.g. *.2xstorage.com), never from
// mangakakalot.gg itself. GIFs are always ads — manga pages are webp/jpg/jpeg/png.
const BANNER_HOST_RE = /^(?:www\.)?mangakakalot\.gg$/i;
const BANNER_PATH_RE = /\/images\/bns\//i;
const GIF_EXT_RE = /\.gif(?:[?#].*)?$/i;

/**
 * Returns true when the URL looks like a real manga chapter page.
 * Exported for unit testing.
 */
export function isMangaPageImage(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;

  // Reject .gif regardless of host
  if (GIF_EXT_RE.test(trimmed)) return false;

  try {
    const parsed = new URL(trimmed);
    // Reject images served from the site's own domain (banner namespace)
    if (BANNER_HOST_RE.test(parsed.hostname)) return false;
    // Reject the banner namespace path on any host (belt-and-suspenders)
    if (BANNER_PATH_RE.test(parsed.pathname)) return false;
  } catch {
    // Relative / unparseable URL — not a CDN image, reject
    return false;
  }

  return true;
}

/**
 * Parses chapter image URLs from a mangakakalot reader page.
 *
 * Filters out banner ads and non-CDN images. Page numbers are sequential (no gaps).
 * Throws MangakakalotParseError when zero page images remain after filtering.
 */
export function parseChapterImages(html: string, url: string): ImageRef[] {
  const $ = cheerio.load(html);
  const images: ImageRef[] = [];

  $(SELECTORS.chapterReaderImage).each((_i, el) => {
    // Prefer data-src (lazy-loaded canonical URL); fall back to src.
    const imgUrl = $(el).attr("data-src") ?? $(el).attr("src") ?? "";
    if (!isMangaPageImage(imgUrl)) return;
    // page is assigned after filtering so numbers are sequential with no gaps
    images.push({ url: imgUrl.trim(), page: 0 });
  });

  // Assign sequential page numbers now that banner entries are excluded
  for (let i = 0; i < images.length; i++) {
    (images[i] as ImageRef).page = i + 1;
  }

  if (images.length === 0) {
    throw new MangakakalotParseError(
      SELECTORS.chapterReaderImage,
      url,
      "no images found in chapter reader container; DOM may have changed",
    );
  }

  return images;
}
