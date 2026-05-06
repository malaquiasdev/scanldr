import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseVolumeMapping } from "./volume-parser.ts";

const fixturesDir = join(import.meta.dir, "../../../../tests/fixtures/mangakakalot");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

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
// parseVolumeMapping — edge cases
// ---------------------------------------------------------------------------

describe("parseVolumeMapping — edge cases", () => {
  it("returns [] when .row-content-chapter is absent", () => {
    const html = "<html><body><h1>Some page</h1></body></html>";
    expect(parseVolumeMapping(html)).toEqual([]);
  });

  it("returns [] for empty HTML string", () => {
    expect(parseVolumeMapping("")).toEqual([]);
  });

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
