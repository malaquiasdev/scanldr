import { describe, expect, test } from "bun:test";
import { isValidAuthSession, toCookieHeader } from "./index.ts";

describe("isValidAuthSession", () => {
  test("accepts a well-shaped session", () => {
    expect(isValidAuthSession({ cookies: { a: "1" }, userAgent: "UA", savedAt: Date.now() })).toBe(
      true,
    );
  });

  test("rejects null/non-object", () => {
    expect(isValidAuthSession(null)).toBe(false);
    expect(isValidAuthSession("nope")).toBe(false);
  });

  test("rejects when cookies is an array or null", () => {
    expect(isValidAuthSession({ cookies: [], userAgent: "UA", savedAt: 1 })).toBe(false);
    expect(isValidAuthSession({ cookies: null, userAgent: "UA", savedAt: 1 })).toBe(false);
  });

  test("rejects when userAgent or savedAt has the wrong type", () => {
    expect(isValidAuthSession({ cookies: {}, userAgent: 1, savedAt: 1 })).toBe(false);
    expect(isValidAuthSession({ cookies: {}, userAgent: "UA", savedAt: "1" })).toBe(false);
  });
});

describe("toCookieHeader", () => {
  test("joins entries as k=v pairs separated by '; '", () => {
    expect(toCookieHeader({ a: "1", b: "2" })).toBe("a=1; b=2");
  });

  test("returns an empty string for no cookies", () => {
    expect(toCookieHeader({})).toBe("");
  });
});
