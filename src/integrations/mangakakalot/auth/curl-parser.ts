// Pure cURL parser — no shell exec, no external deps.
// Supports Chrome (Unix/Windows ^-escapes), Firefox, and Safari "Copy as cURL" formats.

import type { ParsedCurl } from "./types.ts";
import { AuthError } from "./types.ts";

/**
 * Splits a raw cURL string into tokens, handling:
 * - Unix single-quoted strings (no escaping inside)
 * - Unix double-quoted strings (\\ and \" escapes)
 * - Windows cmd ^ line-continuation and ^-escaped chars
 * - Backslash + newline line continuation (bash)
 * - Bare tokens (split on whitespace)
 */
export function tokenizeCurl(input: string): string[] {
  const src = input
    .replace(/\^\r?\n\s*/g, " ") // cmd.exe ^ continuation
    .replace(/\\\r?\n\s*/g, " "); // bash \ continuation

  const tokens: string[] = [];
  let i = 0;

  while (i < src.length) {
    while (i < src.length && /\s/.test(src.charAt(i))) i++;
    if (i >= src.length) break;

    const ch = src.charAt(i);

    if (ch === "'") {
      // Unix single-quoted: literal until closing '
      i++;
      let tok = "";
      while (i < src.length && src.charAt(i) !== "'") {
        tok += src.charAt(i++);
      }
      i++;
      tokens.push(tok);
    } else if (ch === '"') {
      // Unix double-quoted: handle \" and \\ inside
      i++;
      let tok = "";
      while (i < src.length && src.charAt(i) !== '"') {
        if (src.charAt(i) === "\\" && i + 1 < src.length) {
          const next = src.charAt(i + 1);
          if (next === '"' || next === "\\") {
            tok += next;
            i += 2;
          } else {
            tok += src.charAt(i++);
          }
        } else {
          tok += src.charAt(i++);
        }
      }
      i++;
      tokens.push(tok);
    } else {
      // Bare token (ends at whitespace)
      let tok = "";
      while (i < src.length && !/\s/.test(src.charAt(i))) {
        tok += src.charAt(i++);
      }
      tokens.push(tok);
    }
  }

  return tokens;
}

/**
 * Parses cookies from a "key=val; key2=val2" string into a Record.
 */
function parseCookieString(cookieStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of cookieStr.split(";")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const val = pair.slice(eqIdx + 1).trim();
    if (key) result[key] = val;
  }
  return result;
}

/**
 * Parses a raw cURL command string into URL, cookies, and user-agent.
 * Handles Chrome (Unix/Windows), Firefox, and Safari "Copy as cURL" output.
 *
 * Throws `AuthError` if the input is not a recognizable cURL command.
 */
export function parseCurl(input: string): ParsedCurl {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new AuthError("empty input — paste the cURL command copied from DevTools");
  }

  const tokens = tokenizeCurl(trimmed);

  if (tokens[0] !== "curl") {
    const got = trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed;
    throw new AuthError(`Pasted input must be a full cURL command from DevTools.

How to get it:
  1. Open https://www.mangakakalot.gg in your browser
  2. F12 → Network tab → reload the page
  3. Right-click the first request → Copy → Copy as cURL (bash, NOT PowerShell)
  4. Paste into this command:
       pbpaste | scanldr auth     (macOS)
       xclip -selection clipboard -o | scanldr auth    (Linux)

Got: ${got}`);
  }

  let url: string | undefined;
  const cookies: Record<string, string> = {};
  let userAgent: string | undefined;

  let idx = 1;
  while (idx < tokens.length) {
    const tok = tokens[idx] ?? "";

    if (tok === "-H" || tok === "--header") {
      idx++;
      const header = tokens[idx] ?? "";
      const colonIdx = header.indexOf(":");
      if (colonIdx !== -1) {
        const name = header.slice(0, colonIdx).trim().toLowerCase();
        const value = header.slice(colonIdx + 1).trim();
        if (name === "cookie") {
          Object.assign(cookies, parseCookieString(value));
        } else if (name === "user-agent") {
          userAgent = value;
        }
      }
    } else if (tok === "-b" || tok === "--cookie") {
      idx++;
      const cookieVal = tokens[idx] ?? "";
      Object.assign(cookies, parseCookieString(cookieVal));
    } else if (tok === "-A" || tok === "--user-agent") {
      idx++;
      userAgent = tokens[idx] ?? "";
    } else if (
      tok === "-X" ||
      tok === "--request" ||
      tok === "-d" ||
      tok === "--data" ||
      tok === "--data-raw" ||
      tok === "--data-binary" ||
      tok === "-e" ||
      tok === "--referer" ||
      tok === "--referrer" ||
      tok === "--max-time" ||
      tok === "--connect-timeout"
    ) {
      // These flags take a value — skip it.
      idx++;
    } else if (!tok.startsWith("-")) {
      // Positional: the URL (ignore --compressed, --insecure, -k, -s, -L, -v, etc.)
      url = tok;
    }
    // Unknown flags / valueless flags: silently skip

    idx++;
  }

  if (!url) {
    throw new AuthError("could not find a URL in the pasted cURL command");
  }

  return { url, cookies, userAgent };
}
