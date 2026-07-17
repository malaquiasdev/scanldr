import { describe, expect, test } from "bun:test";
import { CHROMIUM_BROWSERS } from "./browsers.ts";
import { deriveUserAgent } from "./ua.ts";

describe("deriveUserAgent", () => {
  test("chrome: Chrome/<version> uses the app version directly, no extra token", () => {
    const ua = deriveUserAgent(CHROMIUM_BROWSERS.chrome, "126.0.6478.127");
    expect(ua).toContain("Chrome/126.0.6478.127");
    expect(ua).not.toMatch(/OPR|Edg/);
  });

  test("opera: no trustworthy Chromium engine version can be derived — returns undefined (issue #205)", () => {
    const ua = deriveUserAgent(CHROMIUM_BROWSERS.opera, "94.0.4606.65");
    expect(ua).toBeUndefined();
  });

  test("brave: returns undefined (issue #205)", () => {
    const ua = deriveUserAgent(CHROMIUM_BROWSERS.brave, "1.65.126");
    expect(ua).toBeUndefined();
  });

  test("edge: returns undefined (issue #205)", () => {
    const ua = deriveUserAgent(CHROMIUM_BROWSERS.edge, "126.0.2592.68");
    expect(ua).toBeUndefined();
  });
});
