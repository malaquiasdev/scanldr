import { describe, expect, test } from "bun:test";
import { CHROMIUM_BROWSERS } from "./browsers.ts";
import { deriveUserAgent } from "./ua.ts";

describe("deriveUserAgent", () => {
  test("chrome: Chrome/<version> uses the app version directly, no extra token", () => {
    const ua = deriveUserAgent(CHROMIUM_BROWSERS.chrome, "126.0.6478.127");
    expect(ua).toContain("Chrome/126.0.6478.127");
    expect(ua).not.toMatch(/OPR|Edg/);
  });

  test("opera: appends OPR/<version> after a fallback Chromium engine token", () => {
    const ua = deriveUserAgent(CHROMIUM_BROWSERS.opera, "94.0.4606.65");
    expect(ua).toContain("Chrome/");
    expect(ua).toContain("OPR/94.0.4606.65");
  });

  test("brave: no product token appended, stays Chrome-shaped", () => {
    const ua = deriveUserAgent(CHROMIUM_BROWSERS.brave, "1.65.126");
    expect(ua).not.toMatch(/Brave/);
    expect(ua).toContain("Chrome/");
  });

  test("edge: appends Edg/<version>", () => {
    const ua = deriveUserAgent(CHROMIUM_BROWSERS.edge, "126.0.2592.68");
    expect(ua).toContain("Edg/126.0.2592.68");
  });
});
