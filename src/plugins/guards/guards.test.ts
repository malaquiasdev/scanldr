import { describe, expect, test } from "bun:test";
import { check, isPlainObject } from "./index.ts";

describe("isPlainObject", () => {
  test("plain object literal → true", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1, b: "two" })).toBe(true);
  });

  test("Object.create(null) → true (typeof object, not array, not null)", () => {
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  test("array → false", () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2, 3])).toBe(false);
  });

  test("null → false", () => {
    expect(isPlainObject(null)).toBe(false);
  });

  test("undefined → false", () => {
    expect(isPlainObject(undefined)).toBe(false);
  });

  test("primitives → false", () => {
    expect(isPlainObject(0)).toBe(false);
    expect(isPlainObject(1)).toBe(false);
    expect(isPlainObject("")).toBe(false);
    expect(isPlainObject("hello")).toBe(false);
    expect(isPlainObject(true)).toBe(false);
    expect(isPlainObject(false)).toBe(false);
  });

  test("function → false", () => {
    expect(isPlainObject(() => {})).toBe(false);
    expect(isPlainObject(function named() {})).toBe(false);
  });

  test("narrows the type to Record<string, unknown>", () => {
    const v: unknown = { foo: "bar" };
    if (isPlainObject(v)) {
      // type test: this line must compile under strict mode
      const _key: unknown = v.foo;
      expect(_key).toBe("bar");
    }
  });
});

describe("check", () => {
  test("truthy condition → no throw", () => {
    expect(() => check(true, new Error("nope"))).not.toThrow();
    expect(() => check(1, new Error("nope"))).not.toThrow();
    expect(() => check("ok", new Error("nope"))).not.toThrow();
    expect(() => check({}, new Error("nope"))).not.toThrow();
    expect(() => check([], new Error("nope"))).not.toThrow();
  });

  test("falsy condition → throws the supplied error instance", () => {
    const err = new Error("boom");
    expect(() => check(false, err)).toThrow(err);
  });

  test("throws the exact supplied subclass", () => {
    class AppError extends Error {}
    const err = new AppError("custom");
    expect(() => check(0, err)).toThrow(AppError);
    expect(() => check(0, err)).toThrow("custom");
  });

  test("each falsy value triggers throw", () => {
    expect(() => check(0, new Error("z"))).toThrow("z");
    expect(() => check("", new Error("z"))).toThrow("z");
    expect(() => check(null, new Error("z"))).toThrow("z");
    expect(() => check(undefined, new Error("z"))).toThrow("z");
    expect(() => check(Number.NaN, new Error("z"))).toThrow("z");
  });

  test("acts as a TypeScript assertion (post-call narrowing)", () => {
    const v: string | null = "x" as string | null;
    check(v !== null, new Error("null"));
    // After check() the type of v is narrowed to string — verifies the
    // `asserts cond` signature compiles and behaves at runtime.
    const upper: string = v.toUpperCase();
    expect(upper).toBe("X");
  });
});
