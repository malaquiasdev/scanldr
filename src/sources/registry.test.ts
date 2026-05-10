import { describe, expect, test } from "bun:test";
import { SOURCES, getSource } from "./registry.ts";

describe("SOURCES registry", () => {
  test("has both mangakakalot and mangadex entries", () => {
    const ids = SOURCES.map((s) => s.id);
    expect(ids).toContain("mangakakalot");
    expect(ids).toContain("mangadex");
  });

  test("mangakakalot requiresAuth === true", () => {
    const s = SOURCES.find((x) => x.id === "mangakakalot");
    expect(s?.requiresAuth).toBe(true);
  });

  test("mangadex requiresAuth === false", () => {
    const s = SOURCES.find((x) => x.id === "mangadex");
    expect(s?.requiresAuth).toBe(false);
  });
});

describe("getSource", () => {
  test("getSource('mangakakalot').requiresAuth === true", () => {
    expect(getSource("mangakakalot").requiresAuth).toBe(true);
  });

  test("getSource('mangadex').requiresAuth === false", () => {
    expect(getSource("mangadex").requiresAuth).toBe(false);
  });

  test("getSource('unknown') throws", () => {
    expect(() => getSource("unknown")).toThrow(/Unknown source/);
  });
});
