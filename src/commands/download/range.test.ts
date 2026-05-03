import { describe, expect, test } from "bun:test";
import { CliError } from "@plugins/errors/index.ts";
import { expandIntegerRange, parseRangeSet } from "./range.ts";

describe("parseRangeSet — happy paths", () => {
  test("single integer", () => {
    const { values } = parseRangeSet("1");
    expect([...values]).toEqual(["1"]);
  });

  test("single fractional", () => {
    const { values } = parseRangeSet("1.5");
    expect([...values]).toEqual(["1.5"]);
  });

  test("integer range", () => {
    const { values } = parseRangeSet("1-3");
    expect([...values]).toEqual(["1", "2", "3"]);
  });

  test("comma-separated list", () => {
    const { values } = parseRangeSet("1,3,7");
    expect([...values]).toEqual(["1", "3", "7"]);
  });

  test("range + specific", () => {
    const { values } = parseRangeSet("1-3,5");
    expect([...values]).toEqual(["1", "2", "3", "5"]);
  });

  test("duplicates are deduped", () => {
    const { values } = parseRangeSet("1-3,2");
    expect([...values]).toEqual(["1", "2", "3"]);
  });

  test("special token none", () => {
    const { values } = parseRangeSet("none");
    expect([...values]).toEqual(["none"]);
  });

  test("large range", () => {
    const { values } = parseRangeSet("1-5,8,10");
    expect([...values]).toEqual(["1", "2", "3", "4", "5", "8", "10"]);
  });
});

describe("parseRangeSet — error cases", () => {
  test("empty string", () => {
    expect(() => parseRangeSet("")).toThrow(CliError);
  });

  test("leading comma", () => {
    expect(() => parseRangeSet(",1")).toThrow(CliError);
  });

  test("trailing comma", () => {
    expect(() => parseRangeSet("1,")).toThrow(CliError);
  });

  test("dangling trailing dash", () => {
    expect(() => parseRangeSet("1-")).toThrow(CliError);
  });

  test("dangling leading dash", () => {
    expect(() => parseRangeSet("-3")).toThrow(CliError);
  });

  test("lower bound greater than upper bound", () => {
    expect(() => parseRangeSet("5-3")).toThrow(CliError);
  });

  test("fractional range bounds", () => {
    expect(() => parseRangeSet("1-2.5")).toThrow(CliError);
  });

  test("fractional lower bound in range", () => {
    expect(() => parseRangeSet("1.5-3")).toThrow(CliError);
  });

  test("invalid characters", () => {
    expect(() => parseRangeSet("abc")).toThrow(CliError);
  });

  test("whitespace in range", () => {
    expect(() => parseRangeSet("1, 2")).toThrow(CliError);
  });
});

describe("expandIntegerRange", () => {
  test("simple range", () => {
    expect(expandIntegerRange("1", "3")).toEqual(["1", "2", "3"]);
  });

  test("single element range", () => {
    expect(expandIntegerRange("5", "5")).toEqual(["5"]);
  });
});
