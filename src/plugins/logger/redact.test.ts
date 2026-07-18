import { describe, expect, test } from "bun:test";
import { redact } from "./redact.ts";

describe("redact — denylisted keys", () => {
  test("redacts each known-sensitive top-level key", () => {
    const input = {
      cookies: "a=b",
      cf_clearance: "raw-cookie",
      useragent: "Mozilla/5.0",
      authorization: "Bearer token",
    };
    expect(redact(input)).toEqual({
      cookies: "[REDACTED]",
      cf_clearance: "[REDACTED]",
      useragent: "[REDACTED]",
      authorization: "[REDACTED]",
    });
  });

  test("denylist match is case-insensitive on key name", () => {
    const input = {
      Cookies: "a",
      CF_CLEARANCE: "b",
      UserAgent: "c",
      Authorization: "d",
    };
    expect(redact(input)).toEqual({
      Cookies: "[REDACTED]",
      CF_CLEARANCE: "[REDACTED]",
      UserAgent: "[REDACTED]",
      Authorization: "[REDACTED]",
    });
  });

  test("non-sensitive values pass through untouched", () => {
    const input = { url: "https://example.com", attempt: 3, ok: true };
    expect(redact(input)).toEqual(input);
  });
});

describe("redact — nested structures", () => {
  test("redacts denylisted keys recursively in nested objects", () => {
    const input = {
      request: {
        headers: { Authorization: "Bearer x", "X-Custom": "ok" },
        meta: { cf_clearance: "raw" },
      },
    };
    expect(redact(input)).toEqual({
      request: {
        headers: { Authorization: "[REDACTED]", "X-Custom": "ok" },
        meta: { cf_clearance: "[REDACTED]" },
      },
    });
  });

  test("redacts inside arrays of objects", () => {
    const input = {
      requests: [
        { url: "/a", Authorization: "t1" },
        { url: "/b", cookies: { cf_clearance: "c" } },
      ],
    };
    const out = redact(input) as { requests: unknown[] };
    expect(out.requests).toEqual([
      { url: "/a", Authorization: "[REDACTED]" },
      { url: "/b", cookies: "[REDACTED]" },
    ]);
  });

  test("redacts a bare array at the top level", () => {
    const input = [{ Authorization: "t1" }, { url: "/b" }];
    expect(redact(input)).toEqual([{ Authorization: "[REDACTED]" }, { url: "/b" }]);
  });

  test("array containing scalars passes through untouched", () => {
    const input = [1, "two", true, null];
    expect(redact(input)).toEqual([1, "two", true, null]);
  });
});

describe("redact — edge cases", () => {
  test("null and undefined pass through", () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  test("empty object returns empty object", () => {
    expect(redact({})).toEqual({});
  });

  test("empty array returns empty array", () => {
    expect(redact([])).toEqual([]);
  });

  test("non-string, non-object scalar values pass through unchanged", () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact("plain string")).toBe("plain string");
  });

  test("does not mutate the input object", () => {
    const input = { cookies: "secret", url: "ok" };
    const snapshotBefore = JSON.stringify(input);
    redact(input);
    expect(JSON.stringify(input)).toBe(snapshotBefore);
  });

  test("value under a denylisted key is redacted even if it is itself an object", () => {
    const input = { cookies: { a: 1, b: { c: 2 } } };
    expect(redact(input)).toEqual({ cookies: "[REDACTED]" });
  });

  test("does not redact keys that merely contain a denylisted substring", () => {
    const input = { cookiesCount: 3, myAuthorizationNote: "x" };
    expect(redact(input)).toEqual({ cookiesCount: 3, myAuthorizationNote: "x" });
  });
});
