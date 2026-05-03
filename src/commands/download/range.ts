import { CliError } from "@plugins/errors/index.ts";
import type { ParsedRange } from "./types.ts";

export { CliError };

function isPositiveNumber(s: string): boolean {
  return /^\d+(\.\d+)?$/.test(s) && Number(s) > 0;
}

function isFractional(s: string): boolean {
  return s.includes(".");
}

export function expandIntegerRange(lo: string, hi: string): string[] {
  const loN = Number(lo);
  const hiN = Number(hi);
  const result: string[] = [];
  for (let i = loN; i <= hiN; i++) {
    result.push(String(i));
  }
  return result;
}

export function parseRangeSet(input: string): ParsedRange {
  if (!input || input.length === 0) {
    throw new CliError("volume range must not be empty");
  }

  // "none" is the special MangaDex no-volume bucket — but deferred per spec
  if (input === "none") {
    return { values: new Set(["none"]) };
  }

  // Leading/trailing comma
  if (input.startsWith(",") || input.endsWith(",")) {
    throw new CliError(`invalid volume range "${input}": leading or trailing comma`);
  }

  const elements = input.split(",");
  const values = new Set<string>();

  for (const element of elements) {
    if (element === "") {
      throw new CliError(`invalid volume range "${input}": empty element (double comma?)`);
    }

    // Check for a dash (range) — but not a leading dash
    const dashIdx = element.indexOf("-");

    if (dashIdx === -1) {
      // bare number
      if (!isPositiveNumber(element)) {
        throw new CliError(`invalid volume range "${input}": "${element}" is not a valid number`);
      }
      values.add(element);
    } else if (dashIdx === 0) {
      throw new CliError(`invalid volume range "${input}": dangling leading dash in "${element}"`);
    } else {
      // potential range "lo-hi"
      const lo = element.slice(0, dashIdx);
      const hi = element.slice(dashIdx + 1);

      if (!hi || hi.length === 0) {
        throw new CliError(
          `invalid volume range "${input}": dangling trailing dash in "${element}"`,
        );
      }

      if (!isPositiveNumber(lo)) {
        throw new CliError(`invalid volume range "${input}": "${lo}" is not a valid number`);
      }
      if (!isPositiveNumber(hi)) {
        throw new CliError(`invalid volume range "${input}": "${hi}" is not a valid number`);
      }

      // Fractional ranges are ambiguous
      if (isFractional(lo) || isFractional(hi)) {
        throw new CliError(
          `invalid volume range "${input}": fractional bounds in a range are ambiguous (use a bare value like "1.5" instead)`,
        );
      }

      const loN = Number(lo);
      const hiN = Number(hi);

      if (loN > hiN) {
        throw new CliError(
          `invalid volume range "${input}": lower bound ${lo} is greater than upper bound ${hi}`,
        );
      }

      for (const v of expandIntegerRange(lo, hi)) {
        values.add(v);
      }
    }
  }

  return { values };
}
