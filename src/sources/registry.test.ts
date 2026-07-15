import { describe, expect, test } from "bun:test";
import { getSource, SOURCES } from "./registry.ts";

describe("SOURCES registry", () => {
  test("has the mangakakalot entry", () => {
    const ids = SOURCES.map((s) => s.id);
    expect(ids).toContain("mangakakalot");
  });

  test("mangakakalot requiresAuth === true", () => {
    const s = SOURCES.find((x) => x.id === "mangakakalot");
    expect(s?.requiresAuth).toBe(true);
  });
});

describe("getSource", () => {
  test("getSource('mangakakalot').requiresAuth === true", () => {
    expect(getSource("mangakakalot").requiresAuth).toBe(true);
  });

  test("getSource('unknown') throws", () => {
    expect(() => getSource("unknown")).toThrow(/Unknown source/);
  });
});
