/**
 * Shared Cloudflare challenge-page detection, used by both the HTTP probe
 * (auth-check.ts probeSession) and the live-browser poll (browser-capture-deps.ts
 * waitForChallengeCleared) so the two heuristics can't drift apart.
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
