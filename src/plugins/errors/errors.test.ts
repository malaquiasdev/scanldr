import { describe, expect, test } from "bun:test";
import { CliError } from "./index.ts";

describe("CliError", () => {
  test("name is CliError", () => {
    expect(new CliError("boom").name).toBe("CliError");
  });

  test("default exitCode is 2", () => {
    expect(new CliError("boom").exitCode).toBe(2);
  });

  test("custom exitCode is preserved", () => {
    expect(new CliError("boom", 5).exitCode).toBe(5);
  });

  test("instanceof CliError is true", () => {
    expect(new CliError("boom")).toBeInstanceOf(CliError);
  });
});
