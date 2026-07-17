// Multi-profile selection: picks the Chromium profile whose `cf_clearance` for the
// target domain exists and has the freshest creation_utc (i.e. the most recently
// solved Cloudflare challenge — the user may have stale sessions in other profiles).

import type { CookieRow, ProfileCookies } from "./types.ts";

/** Returns the row for a given cookie name, or undefined. */
function findRow(rows: CookieRow[], name: string): CookieRow | undefined {
  return rows.find((r) => r.name === name);
}

/**
 * Picks the profile with the newest `cf_clearance` (by creation_utc) among profiles
 * that have one at all. Returns undefined when no profile has a cf_clearance row.
 */
export function selectFreshestProfile(profiles: ProfileCookies[]): ProfileCookies | undefined {
  let best: ProfileCookies | undefined;
  let bestCreation = -Infinity;

  for (const profile of profiles) {
    const clearance = findRow(profile.rows, "cf_clearance");
    if (!clearance) continue;
    if (clearance.creationUtc > bestCreation) {
      best = profile;
      bestCreation = clearance.creationUtc;
    }
  }

  return best;
}
