import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MangakakalotParseError } from "./types.ts";
import { chaptersToVolumeMap, parseVolumeMapping } from "./volume-parser.ts";

const fixturesDir = join(import.meta.dir, "../../../../tests/fixtures/mangakakalot");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

// ---------------------------------------------------------------------------
// parseVolumeMapping — naruto real fixture (DOM drift, see #95)
// Verbatim capture of https://www.mangakakalot.gg/manga/naruto.
// mangakakalot.gg migrated this series' chapter list to a client-side API fetch:
// the response contains <div id="chapter-list-container" data-api-url="..."> and
// no inline <ul class="row-content-chapter">. Drift detector (#74) must fire.
// Future API-based parser tracked by #95.
// ---------------------------------------------------------------------------

describe("parseVolumeMapping — naruto real fixture (DOM drift)", () => {
  it("throws MangakakalotParseError against verbatim production HTML", () => {
    const html = readFixture("manga-page-naruto-real.html");
    expect(() => parseVolumeMapping(html, "https://www.mangakakalot.gg/manga/naruto")).toThrow(
      MangakakalotParseError,
    );
  });

  it("thrown error reports the chapter list selector and url", () => {
    expect.assertions(3);
    const html = readFixture("manga-page-naruto-real.html");
    try {
      parseVolumeMapping(html, "https://www.mangakakalot.gg/manga/naruto");
    } catch (err) {
      expect(err).toBeInstanceOf(MangakakalotParseError);
      const parseErr = err as MangakakalotParseError;
      expect(parseErr.selector).toBe("ul.row-content-chapter li");
      expect(parseErr.url).toBe("https://www.mangakakalot.gg/manga/naruto");
    }
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
    expect.assertions(3);
    const html = readFixture("manga-page-drift.html");
    try {
      parseVolumeMapping(html, "https://www.mangakakalot.gg/manga/dandadan");
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

  it("returns [] for error page with only <h1>404</h1> (single signal, no throw)", () => {
    // Only 1 signal (h1 with >=3 chars). Score < 2 → not a manga page → silent [].
    const html = "<html><body><h1>404</h1><p>Page not found.</p></body></html>";
    expect(parseVolumeMapping(html, "https://www.mangakakalot.gg/manga/notfound")).toEqual([]);
  });

  it("returns [] for redirect-to-home page (popular sidebar but no manga-detail markers)", () => {
    // Only has h1 + popular sidebar links but no og:title / og:type / manga-info containers.
    const html = `<html><body>
      <h1>Welcome to MangaKakalot</h1>
      <div class="slide-caption">
        <h3>Popular Manga</h3>
        <a href="/manga/one-piece">One Piece</a>
        <a href="/manga/naruto">Naruto</a>
      </div>
    </body></html>`;
    expect(parseVolumeMapping(html, "https://www.mangakakalot.gg/")).toEqual([]);
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

// ---------------------------------------------------------------------------
// chaptersToVolumeMap
// ---------------------------------------------------------------------------

function makeChapter(overrides: {
  id: string;
  chapter: string;
  volume?: string | null;
}) {
  return {
    id: overrides.id,
    volume: overrides.volume ?? null,
    chapter: overrides.chapter,
    title: null,
    translatedLanguage: "en",
    scanlationGroup: null,
    readableAt: "2024-01-01T00:00:00.000000Z",
    externalUrl: null,
  };
}

describe("chaptersToVolumeMap", () => {
  it("empty array → empty VolumeMap", () => {
    expect(chaptersToVolumeMap([])).toEqual([]);
  });

  it("all volume:null → single 'unknown' bucket sorted ascending", () => {
    const chapters = [
      makeChapter({ id: "naruto/ch-10", chapter: "10" }),
      makeChapter({ id: "naruto/ch-1", chapter: "1" }),
      makeChapter({ id: "naruto/ch-5", chapter: "5" }),
    ];
    const map = chaptersToVolumeMap(chapters);
    expect(map).toHaveLength(1);
    expect(map[0]?.volume).toBe("unknown");
    expect(map[0]?.chapters.map((c) => c.chapter)).toEqual(["1", "5", "10"]);
  });

  it("passes chapter id through unchanged", () => {
    const chapters = [makeChapter({ id: "naruto/chapter-700", chapter: "700" })];
    const map = chaptersToVolumeMap(chapters);
    expect(map[0]?.chapters[0]?.id).toBe("naruto/chapter-700");
  });

  it("mix of numeric volumes → numeric buckets ascending, unknown last", () => {
    const chapters = [
      makeChapter({ id: "test/ch-1", chapter: "1", volume: "1" }),
      makeChapter({ id: "test/ch-2", chapter: "2", volume: "3" }),
      makeChapter({ id: "test/ch-3", chapter: "3", volume: null }),
      makeChapter({ id: "test/ch-4", chapter: "4", volume: "2" }),
    ];
    const map = chaptersToVolumeMap(chapters);
    expect(map.map((b) => b.volume)).toEqual(["1", "2", "3", "unknown"]);
  });

  it("empty string volume treated as unknown", () => {
    const chapters = [makeChapter({ id: "test/ch-1", chapter: "1", volume: "" })];
    const map = chaptersToVolumeMap(chapters);
    expect(map[0]?.volume).toBe("unknown");
  });

  it("non-numeric volume string (e.g. 'Special') is routed to 'unknown' bucket", () => {
    const chapters = [makeChapter({ id: "test/ch-1", chapter: "1", volume: "Special" })];
    const map = chaptersToVolumeMap(chapters);
    expect(map).toHaveLength(1);
    expect(map[0]?.volume).toBe("unknown");
  });

  it("whitespace-only volume string is routed to 'unknown' bucket", () => {
    const chapters = [makeChapter({ id: "test/ch-1", chapter: "1", volume: "   " })];
    const map = chaptersToVolumeMap(chapters);
    expect(map).toHaveLength(1);
    expect(map[0]?.volume).toBe("unknown");
  });

  it("mix of numeric, null, and non-numeric volumes → numeric buckets ascending then 'unknown'", () => {
    const chapters = [
      makeChapter({ id: "test/ch-1", chapter: "1", volume: "1" }),
      makeChapter({ id: "test/ch-2", chapter: "2", volume: null }),
      makeChapter({ id: "test/ch-3", chapter: "3", volume: "Extra" }),
      makeChapter({ id: "test/ch-4", chapter: "4", volume: "2" }),
      makeChapter({ id: "test/ch-5", chapter: "5", volume: "side-story" }),
    ];
    const map = chaptersToVolumeMap(chapters);
    expect(map.map((b) => b.volume)).toEqual(["1", "2", "unknown"]);
    // null + "Extra" + "side-story" all land in unknown (3 chapters)
    const unknown = map.find((b) => b.volume === "unknown");
    expect(unknown?.chapters).toHaveLength(3);
  });

  it("chapters within a numeric bucket are sorted ascending", () => {
    const chapters = [
      makeChapter({ id: "test/ch-3", chapter: "3", volume: "1" }),
      makeChapter({ id: "test/ch-1", chapter: "1", volume: "1" }),
      makeChapter({ id: "test/ch-2", chapter: "2", volume: "1" }),
    ];
    const map = chaptersToVolumeMap(chapters);
    expect(map[0]?.chapters.map((c) => c.chapter)).toEqual(["1", "2", "3"]);
  });
});
