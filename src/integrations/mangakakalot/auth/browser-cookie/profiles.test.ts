import { describe, expect, test } from "bun:test";
import { selectFreshestProfile } from "./profiles.ts";
import type { CookieRow, ProfileCookies } from "./types.ts";

function cfRow(creationUtc: number): CookieRow {
  return {
    hostKey: ".mangakakalot.gg",
    name: "cf_clearance",
    encryptedValue: new Uint8Array(),
    creationUtc,
    expiresUtc: creationUtc + 1_000_000,
  };
}

describe("selectFreshestProfile", () => {
  test("picks the profile with the newest cf_clearance creation_utc", () => {
    const profiles: ProfileCookies[] = [
      { profile: "Default", rows: [cfRow(100)] },
      { profile: "Profile 1", rows: [cfRow(500)] },
      { profile: "Profile 2", rows: [cfRow(300)] },
    ];
    expect(selectFreshestProfile(profiles)?.profile).toBe("Profile 1");
  });

  test("ignores profiles without a cf_clearance row", () => {
    const profiles: ProfileCookies[] = [
      { profile: "Default", rows: [] },
      { profile: "Profile 1", rows: [cfRow(200)] },
    ];
    expect(selectFreshestProfile(profiles)?.profile).toBe("Profile 1");
  });

  test("returns undefined when no profile has cf_clearance", () => {
    const profiles: ProfileCookies[] = [
      { profile: "Default", rows: [] },
      { profile: "Profile 1", rows: [] },
    ];
    expect(selectFreshestProfile(profiles)).toBeUndefined();
  });
});
