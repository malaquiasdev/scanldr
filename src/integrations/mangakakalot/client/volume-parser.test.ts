import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MangakakalotParseError } from "./types.ts";
import { parseVolumeMapping } from "./volume-parser.ts";

const fixturesDir = join(import.meta.dir, "../../../../tests/fixtures/mangakakalot");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

// ---------------------------------------------------------------------------
// parseVolumeMapping — naruto real-structure fixture (≥50 chapters required)
// Series: naruto (non-DMCA series). Fixture: manga-page-naruto-real.html.
// Captured: 2026-05-06 (structure modeled from real-chapter-dandadan-1.html DOM;
// direct fetch unavailable due to expired Cloudflare auth session).
// ---------------------------------------------------------------------------

describe("parseVolumeMapping — naruto real-structure fixture", () => {
  it("returns at least 1 volume bucket", () => {
    const html = readFixture("manga-page-naruto-real.html");
    const map = parseVolumeMapping(html);
    expect(map.length).toBeGreaterThanOrEqual(1);
  });

  it("returns at least 50 chapters total across all buckets", () => {
    const html = readFixture("manga-page-naruto-real.html");
    const map = parseVolumeMapping(html);
    const totalChapters = map.reduce((sum, b) => sum + b.chapters.length, 0);
    expect(totalChapters).toBeGreaterThanOrEqual(50);
  });

  it("volumes are sorted numerically ascending", () => {
    const html = readFixture("manga-page-naruto-real.html");
    const map = parseVolumeMapping(html);
    const numericVolumes = map.filter((b) => b.volume !== "unknown").map((b) => Number(b.volume));
    expect(numericVolumes).toEqual([...numericVolumes].sort((a, b) => a - b));
  });

  it("composite id follows <slug>/<chapter-slug> convention", () => {
    const html = readFixture("manga-page-naruto-real.html");
    const map = parseVolumeMapping(html);
    const firstChapter = map[0]?.chapters[0];
    expect(firstChapter?.id).toMatch(/^naruto\/chapter-\d+$/);
  });
});

// ---------------------------------------------------------------------------
// parseVolumeMapping — Dandadan fixture (all_external series with volume labels)
// ---------------------------------------------------------------------------

describe("parseVolumeMapping — Dandadan fixture", () => {
  it("returns volume buckets sorted numerically ascending", () => {
    const html = readFixture("manga-page-dandadan.html");
    const map = parseVolumeMapping(html);

    const volumes = map.map((b) => b.volume);
    expect(volumes).toEqual(["1", "11", "12", "13"]);
  });

  it("volume 13 has 3 chapters sorted ascending", () => {
    const html = readFixture("manga-page-dandadan.html");
    const map = parseVolumeMapping(html);

    const vol13 = map.find((b) => b.volume === "13");
    expect(vol13).toBeDefined();
    expect(vol13?.chapters.map((c) => c.chapter)).toEqual(["128", "129", "130"]);
  });

  it("composite id follows <slug>/<chapter-slug> convention", () => {
    const html = readFixture("manga-page-dandadan.html");
    const map = parseVolumeMapping(html);

    const vol13 = map.find((b) => b.volume === "13");
    expect(vol13?.chapters[0]?.id).toBe("dandadan/chapter-128");
    expect(vol13?.chapters[1]?.id).toBe("dandadan/chapter-129");
    expect(vol13?.chapters[2]?.id).toBe("dandadan/chapter-130");
  });
});

// ---------------------------------------------------------------------------
// parseVolumeMapping — JJK fixture
// ---------------------------------------------------------------------------

describe("parseVolumeMapping — JJK fixture", () => {
  it("returns expected volumes", () => {
    const html = readFixture("manga-page-jjk.html");
    const map = parseVolumeMapping(html);

    const volumes = map.map((b) => b.volume);
    expect(volumes).toEqual(["1", "26", "27"]);
  });

  it("volume 27 has 2 chapters", () => {
    const html = readFixture("manga-page-jjk.html");
    const map = parseVolumeMapping(html);

    const vol27 = map.find((b) => b.volume === "27");
    expect(vol27?.chapters).toHaveLength(2);
    expect(vol27?.chapters.map((c) => c.chapter)).toEqual(["270", "271"]);
  });
});

// ---------------------------------------------------------------------------
// parseVolumeMapping — flat list (no volume labels)
// ---------------------------------------------------------------------------

describe("parseVolumeMapping — flat list (no volume labels)", () => {
  it("returns a single 'unknown' bucket with all chapters", () => {
    const html = readFixture("manga-page-flat.html");
    const map = parseVolumeMapping(html);

    expect(map).toHaveLength(1);
    expect(map[0]?.volume).toBe("unknown");
    expect(map[0]?.chapters.map((c) => c.chapter)).toEqual(["1", "5", "10"]);
  });
});

// ---------------------------------------------------------------------------
// parseVolumeMapping — DOM drift detection (#74)
// ---------------------------------------------------------------------------

describe("parseVolumeMapping — DOM drift detection", () => {
  it("throws MangakakalotParseError when manga page has h1/og:title but no chapter list", () => {
    const html = readFixture("manga-page-drift.html");
    expect(() => parseVolumeMapping(html, "https://www.mangakakalot.gg/manga/dandadan")).toThrow(
      MangakakalotParseError,
    );
  });

  it("thrown error includes the selector and url", () => {
    const html = readFixture("manga-page-drift.html");
    try {
      parseVolumeMapping(html, "https://www.mangakakalot.gg/manga/dandadan");
      expect(true).toBe(false); // must not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(MangakakalotParseError);
      const parseErr = err as MangakakalotParseError;
      expect(parseErr.selector).toBe("ul.row-content-chapter li");
      expect(parseErr.url).toBe("https://www.mangakakalot.gg/manga/dandadan");
    }
  });

  it("returns [] for genuinely empty / non-manga pages (blank HTML)", () => {
    expect(parseVolumeMapping("")).toEqual([]);
  });

  it("returns [] for plain non-manga pages (no title/og markers)", () => {
    const html = "<html><body><p>Some generic page content.</p></body></html>";
    expect(parseVolumeMapping(html, "https://example.com/page")).toEqual([]);
  });

  it("returns [] for minimal HTML without manga identifiers", () => {
    const html = "<html><body></body></html>";
    expect(parseVolumeMapping(html)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseVolumeMapping — edge cases
// ---------------------------------------------------------------------------

describe("parseVolumeMapping — edge cases", () => {
  it("normalises leading-zero volume numbers (Vol.01 → '1')", () => {
    const html = `<html><body>
      <ul class="row-content-chapter">
        <li class="a-h"><a class="chapter-name text-nowrap" href="https://www.mangakakalot.gg/manga/test/chapter-1">Vol.01 Ch.001</a></li>
      </ul>
    </body></html>`;
    const map = parseVolumeMapping(html);
    expect(map[0]?.volume).toBe("1");
    expect(map[0]?.chapters[0]?.chapter).toBe("1");
  });

  it("chapters within a volume are sorted by chapter number ascending", () => {
    // Fixture provides chapters newest-first (130, 129, 128)
    const html = readFixture("manga-page-dandadan.html");
    const map = parseVolumeMapping(html);
    const vol13 = map.find((b) => b.volume === "13");
    const nums = vol13?.chapters.map((c) => Number(c.chapter)) ?? [];
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
  });
});
