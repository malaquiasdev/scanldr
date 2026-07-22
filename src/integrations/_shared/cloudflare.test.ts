import { describe, expect, test } from "bun:test";
import { hasCloudflareChallengeMarkers } from "./cloudflare.ts";

describe("hasCloudflareChallengeMarkers", () => {
  test("detects cf-browser-verification marker", () => {
    expect(hasCloudflareChallengeMarkers('<div class="cf-browser-verification"></div>')).toBe(true);
  });

  test("detects challenge-platform marker", () => {
    expect(hasCloudflareChallengeMarkers("script src=challenge-platform/h/b")).toBe(true);
  });

  test("detects cdn-cgi/challenge-platform marker", () => {
    expect(hasCloudflareChallengeMarkers("/cdn-cgi/challenge-platform/h/b/orchestrate")).toBe(true);
  });

  test("detects jschl-answer marker", () => {
    expect(hasCloudflareChallengeMarkers('<input name="jschl-answer">')).toBe(true);
  });

  test("detects 'Just a moment' marker", () => {
    expect(hasCloudflareChallengeMarkers("<title>Just a moment...</title>")).toBe(true);
  });

  test("detects short cloudflare+cf_clearance combo page", () => {
    const text = "cloudflare cf_clearance pending please wait";
    expect(hasCloudflareChallengeMarkers(text)).toBe(true);
  });

  test("does NOT flag a long page merely mentioning cloudflare and cf_clearance", () => {
    const padding = "x".repeat(20000);
    const text = `cloudflare cf_clearance ${padding}`;
    expect(hasCloudflareChallengeMarkers(text)).toBe(false);
  });

  test("returns false for cloudflare mention without cf_clearance", () => {
    expect(hasCloudflareChallengeMarkers("Powered by cloudflare")).toBe(false);
  });

  test("returns false for cf_clearance mention without cloudflare", () => {
    expect(hasCloudflareChallengeMarkers("cf_clearance=abc123")).toBe(false);
  });

  test("returns false for a normal page with none of the markers", () => {
    expect(hasCloudflareChallengeMarkers("<html><body>Manga chapter 1</body></html>")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(hasCloudflareChallengeMarkers("")).toBe(false);
  });
});
