/**
 * Parses the hostname from a URL and returns the first label (e.g. "mangaplus").
 * Returns `null` when the URL is malformed so callers can distinguish "bad URL"
 * from "valid URL with no useful label" (empty host), instead of silently swallowing
 * the parse error.
 */
export function parseExternalHost(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] ?? host;
  } catch {
    return null;
  }
}
