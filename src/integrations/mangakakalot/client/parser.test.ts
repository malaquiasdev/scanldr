import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMangaPageImage, parseChapterImages } from "./parser.ts";

const fixturesDir = join(import.meta.dir, "../../../../tests/fixtures/mangakakalot");

// ---------------------------------------------------------------------------
// isMangaPageImage
// ---------------------------------------------------------------------------

describe("isMangaPageImage", () => {
  it("accepts webp from CDN host", () => {
    expect(isMangaPageImage("https://img-r1.2xstorage.com/manga/ch1/3.5/12.webp")).toBe(true);
  });

  it("accepts jpg from CDN host", () => {
    expect(isMangaPageImage("https://img-r2.2xstorage.com/manga/ch1/1.jpg")).toBe(true);
  });

  it("accepts jpeg from CDN host", () => {
    expect(isMangaPageImage("https://img-r1.2xstorage.com/manga/ch1/1.jpeg")).toBe(true);
  });

  it("accepts png from CDN host", () => {
    expect(isMangaPageImage("https://img-r1.2xstorage.com/manga/ch1/1.png")).toBe(true);
  });

  it("rejects gif extension on any host", () => {
    expect(isMangaPageImage("https://img-r1.2xstorage.com/banners/promo.gif")).toBe(false);
  });

  it("rejects /images/bns/ path", () => {
    expect(isMangaPageImage("https://img-r1.2xstorage.com/images/bns/common/ad.gif")).toBe(false);
  });

  it("rejects mangakakalot.gg host", () => {
    expect(isMangaPageImage("https://mangakakalot.gg/images/bns/common/ehentaiai.gif")).toBe(false);
  });

  it("rejects www.mangakakalot.gg host", () => {
    expect(isMangaPageImage("https://www.mangakakalot.gg/images/bns/common/ehentaiai.gif")).toBe(
      false,
    );
  });

  it("rejects unparseable URL", () => {
    expect(isMangaPageImage("not-a-url")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseChapterImages — banner filtering
// ---------------------------------------------------------------------------

describe("parseChapterImages — banner filtering", () => {
  it("excludes banner ads and renumbers pages sequentially (chapter-with-banners.html)", () => {
    const html = readFixture("chapter-with-banners.html");
    const images = parseChapterImages(html, "https://www.mangakakalot.gg/manga/test/ch1");

    // 4 real pages, 3 banners/gifs should be filtered out
    expect(images).toHaveLength(4);
    expect(images.map((i) => i.page)).toEqual([1, 2, 3, 4]);
    expect(images[0]?.url).toBe("https://img-r1.2xstorage.com/manga/ch1/1.webp");
    expect(images[1]?.url).toBe("https://img-r1.2xstorage.com/manga/ch1/2.webp");
    expect(images[2]?.url).toBe("https://img-r1.2xstorage.com/manga/ch1/3.jpg");
    expect(images[3]?.url).toBe("https://img-r2.2xstorage.com/manga/ch1/4.png");
  });

  it("no regression: chapter-naruto-1.html returns 3 pages sequentially", () => {
    const html = readFixture("chapter-naruto-1.html");
    const images = parseChapterImages(html, "https://www.mangakakalot.gg/manga/naruto/ch1");

    expect(images).toHaveLength(3);
    expect(images.map((i) => i.page)).toEqual([1, 2, 3]);
  });
});

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}
