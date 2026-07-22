/**
 * Shared Cloudflare challenge-page detection. Single source of truth for both
 * `walkthrough` (auth-check.ts probeSession, browser-capture-deps.ts
 * waitForChallengeCleared) and `integrations/fallback-http` (dispatch's
 * in-body CF detection) so the heuristics can't drift apart.
 */
export function hasCloudflareChallengeMarkers(text: string): boolean {
  return (
    text.includes("cf-browser-verification") ||
    text.includes("challenge-platform") ||
    text.includes("cdn-cgi/challenge-platform") ||
    text.includes("jschl-answer") ||
    text.includes("Just a moment") ||
    (text.includes("cloudflare") && text.includes("cf_clearance") && text.length < 20000)
  );
}
