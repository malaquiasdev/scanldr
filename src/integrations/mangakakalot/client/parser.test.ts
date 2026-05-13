import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectChapterApiPlaceholder, isMangaPageImage, parseChapterImages } from "./parser.ts";

const fixturesDir = join(import.meta.dir, "../../../../tests/fixtures/mangakakalot");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

// ---------------------------------------------------------------------------
// isMangaPageImage
// ---------------------------------------------------------------------------

describe("isMangaPageImage", () => {
  it("accepts CDN webp URL", () => {
    expect(isMangaPageImage("https://img-r1.2xstorage.com/manga/test/ch1/1.webp")).toBe(true);
  });

  it("accepts CDN jpg URL", () => {
    expect(isMangaPageImage("https://img-r1.2xstorage.com/manga/test/ch1/1.jpg")).toBe(true);
  });

  it("accepts CDN jpeg URL", () => {
    expect(isMangaPageImage("https://img-r1.2xstorage.com/manga/test/ch1/1.jpeg")).toBe(true);
  });

  it("accepts CDN png URL", () => {
    expect(isMangaPageImage("https://img-r1.2xstorage.com/manga/test/ch1/1.png")).toBe(true);
  });

  it("rejects .gif on CDN host", () => {
    expect(isMangaPageImage("https://img-r1.2xstorage.com/ads/banner.gif")).toBe(false);
  });

  it("rejects image on www.mangakakalot.gg", () => {
    expect(isMangaPageImage("https://www.mangakakalot.gg/images/bns/common/ehentaiai.gif")).toBe(
      false,
    );
  });

  it("rejects image on mangakakalot.gg (no www)", () => {
    expect(isMangaPageImage("https://mangakakalot.gg/promo/something.png")).toBe(false);
  });

  it("rejects /images/bns/ path on any host", () => {
    expect(isMangaPageImage("https://cdn.example.com/images/bns/ad.jpg")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isMangaPageImage("")).toBe(false);
  });

  it("rejects relative URL", () => {
    expect(isMangaPageImage("/manga/test/ch1/1.webp")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseChapterImages — banner filtering
// ---------------------------------------------------------------------------

describe("parseChapterImages — banner filtering", () => {
  it("excludes banner ads and renumbers pages sequentially", () => {
    const html = readFixture("chapter-with-banners.html");
    const images = parseChapterImages(html, "https://www.mangakakalot.gg/test");

    expect(images).toHaveLength(4);
    expect(images.map((img) => img.page)).toEqual([1, 2, 3, 4]);
    expect(images.every((img) => img.url.includes("2xstorage.com"))).toBe(true);
  });

  it("does not regress on chapter-naruto-1.html (no banners)", () => {
    const html = readFixture("chapter-naruto-1.html");
    const images = parseChapterImages(html, "https://www.mangakakalot.gg/naruto/chapter-1");

    expect(images).toHaveLength(3);
    expect(images.map((img) => img.page)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// detectChapterApiPlaceholder
// ---------------------------------------------------------------------------

describe("detectChapterApiPlaceholder", () => {
  it("returns { slug: 'naruto' } for manga-page-naruto-real.html", () => {
    const html = readFixture("manga-page-naruto-real.html");
    const result = detectChapterApiPlaceholder(html);
    expect(result).toEqual({ slug: "naruto" });
  });

  it("returns null for manga-page-dandadan.html (no placeholder)", () => {
    const html = readFixture("manga-page-dandadan.html");
    expect(detectChapterApiPlaceholder(html)).toBeNull();
  });

  it("returns null for empty HTML", () => {
    expect(detectChapterApiPlaceholder("")).toBeNull();
  });

  it("returns null for blank whitespace HTML", () => {
    expect(detectChapterApiPlaceholder("   ")).toBeNull();
  });

  it("returns null when container div present but data-comic-slug is empty", () => {
    const html = `<html><body>
      <div id="chapter-list-container"
           data-comic-slug=""
           data-api-url="https://www.mangakakalot.gg/api/manga/__SLUG__/chapters">
        Loading...
      </div>
    </body></html>`;
    expect(detectChapterApiPlaceholder(html)).toBeNull();
  });

  it("returns null when container div present but data-api-url is missing", () => {
    const html = `<html><body>
      <div id="chapter-list-container" data-comic-slug="naruto">
        Loading...
      </div>
    </body></html>`;
    expect(detectChapterApiPlaceholder(html)).toBeNull();
  });

  it("returns null when container div present but data-comic-slug is missing", () => {
    const html = `<html><body>
      <div id="chapter-list-container"
           data-api-url="https://www.mangakakalot.gg/api/manga/__SLUG__/chapters">
        Loading...
      </div>
    </body></html>`;
    expect(detectChapterApiPlaceholder(html)).toBeNull();
  });

  it("trims whitespace from slug", () => {
    const html = `<html><body>
      <div id="chapter-list-container"
           data-comic-slug="  naruto  "
           data-api-url="https://www.mangakakalot.gg/api/manga/__SLUG__/chapters">
        Loading...
      </div>
    </body></html>`;
    const result = detectChapterApiPlaceholder(html);
    expect(result).toEqual({ slug: "naruto" });
  });
});
