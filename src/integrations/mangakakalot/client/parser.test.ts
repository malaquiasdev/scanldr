import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectChapterApiPlaceholder } from "./parser.ts";

const fixturesDir = join(import.meta.dir, "../../../../tests/fixtures/mangakakalot");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

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
