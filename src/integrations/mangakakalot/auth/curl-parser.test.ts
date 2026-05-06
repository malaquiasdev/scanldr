import { describe, expect, test } from "bun:test";
import { parseCurl, tokenizeCurl } from "./curl-parser.ts";
import { AuthError } from "./types.ts";

// ---------------------------------------------------------------------------
// tokenizeCurl
// ---------------------------------------------------------------------------

describe("tokenizeCurl", () => {
  test("handles single-quoted tokens", () => {
    expect(tokenizeCurl("curl 'https://example.com'")).toEqual(["curl", "https://example.com"]);
  });

  test("handles double-quoted tokens with escape", () => {
    expect(tokenizeCurl('curl "https://example.com" -H "cookie: a=\\"b\\""')).toEqual([
      "curl",
      "https://example.com",
      "-H",
      'cookie: a="b"',
    ]);
  });

  test("handles bash backslash line continuation", () => {
    const input = "curl 'https://example.com' \\\n  -H 'accept: */*'";
    const tokens = tokenizeCurl(input);
    expect(tokens).toContain("https://example.com");
    expect(tokens).toContain("-H");
    expect(tokens).toContain("accept: */*");
  });

  test("handles Windows cmd ^ line continuation", () => {
    const input = "curl 'https://example.com' ^\r\n  -H 'accept: */*'";
    const tokens = tokenizeCurl(input);
    expect(tokens).toContain("https://example.com");
    expect(tokens).toContain("accept: */*");
  });
});

// ---------------------------------------------------------------------------
// parseCurl — Chrome Unix
// ---------------------------------------------------------------------------

describe("parseCurl — Chrome Unix", () => {
  const chromeCurlUnix = `curl 'https://www.mangakakalot.gg/search/story/dragon-ball' \\
  -H 'accept: text/html,application/xhtml+xml' \\
  -H 'accept-language: en-US,en;q=0.9' \\
  -H 'cookie: cf_clearance=abc123; __cf_bm=xyz; _ga=GA1.1.111' \\
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' \\
  --compressed`;

  test("extracts URL", () => {
    const result = parseCurl(chromeCurlUnix);
    expect(result.url).toBe("https://www.mangakakalot.gg/search/story/dragon-ball");
  });

  test("extracts cf_clearance from -H cookie header", () => {
    const result = parseCurl(chromeCurlUnix);
    expect(result.cookies.cf_clearance).toBe("abc123");
  });

  test("extracts all cookies from -H cookie header", () => {
    const result = parseCurl(chromeCurlUnix);
    expect(result.cookies.__cf_bm).toBe("xyz");
    expect(result.cookies._ga).toBe("GA1.1.111");
  });

  test("extracts user-agent (case-insensitive header name)", () => {
    const result = parseCurl(chromeCurlUnix);
    expect(result.userAgent).toBe(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    );
  });
});

// ---------------------------------------------------------------------------
// parseCurl — Chrome Windows (^ escapes)
// ---------------------------------------------------------------------------

describe("parseCurl — Chrome Windows", () => {
  const chromeCurlWindows =
    'curl "https://www.mangakakalot.gg/search/story/dragon-ball" ^\r\n' +
    '  -H "cookie: cf_clearance=win_clear; _ga=GA1.1.999" ^\r\n' +
    '  -H "user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)"';

  test("parses Windows ^ continuation correctly", () => {
    const result = parseCurl(chromeCurlWindows);
    expect(result.url).toBe("https://www.mangakakalot.gg/search/story/dragon-ball");
    expect(result.cookies.cf_clearance).toBe("win_clear");
    expect(result.cookies._ga).toBe("GA1.1.999");
    expect(result.userAgent).toBe("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
  });
});

// ---------------------------------------------------------------------------
// parseCurl — Firefox (uses -b for cookies)
// ---------------------------------------------------------------------------

describe("parseCurl — Firefox", () => {
  const firefoxCurl = `curl 'https://www.mangakakalot.gg/search/story/dragon-ball' \\
  -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0' \\
  -b 'cf_clearance=firefox_clear; __cf_bm=bm_val; _ga=GA1.2.444'`;

  test("extracts cookies from -b flag", () => {
    const result = parseCurl(firefoxCurl);
    expect(result.cookies.cf_clearance).toBe("firefox_clear");
    expect(result.cookies.__cf_bm).toBe("bm_val");
  });

  test("extracts user-agent (mixed case header name)", () => {
    const result = parseCurl(firefoxCurl);
    expect(result.userAgent).toBe(
      "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0",
    );
  });
});

// ---------------------------------------------------------------------------
// parseCurl — Safari
// ---------------------------------------------------------------------------

describe("parseCurl — Safari", () => {
  const safariCurl = `curl 'https://www.mangakakalot.gg/search/story/dragon-ball' \\
  -H 'Accept: text/html' \\
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15' \\
  -H 'Cookie: cf_clearance=safari_clear; _ga=GA1.1.555'`;

  test("extracts cookies from Cookie header (capitalized)", () => {
    const result = parseCurl(safariCurl);
    expect(result.cookies.cf_clearance).toBe("safari_clear");
  });

  test("extracts user-agent from User-Agent header (capitalized)", () => {
    const result = parseCurl(safariCurl);
    expect(result.userAgent).toContain("Safari");
  });
});

// ---------------------------------------------------------------------------
// parseCurl — merges -H cookie and -b cookie
// ---------------------------------------------------------------------------

describe("parseCurl — cookie merging", () => {
  test("merges -H cookie and -b when both present", () => {
    const input = `curl 'https://example.com' \\
  -H 'cookie: _ga=GA1' \\
  -b 'cf_clearance=merged_clear' \\
  -H 'user-agent: Mozilla/5.0'`;
    const result = parseCurl(input);
    expect(result.cookies._ga).toBe("GA1");
    expect(result.cookies.cf_clearance).toBe("merged_clear");
  });
});

// ---------------------------------------------------------------------------
// parseCurl — error cases
// ---------------------------------------------------------------------------

describe("parseCurl — errors", () => {
  test("throws AuthError on empty input", () => {
    expect(() => parseCurl("")).toThrow(AuthError);
    expect(() => parseCurl("   ")).toThrow(AuthError);
  });

  test("throws AuthError when input doesn't start with curl", () => {
    expect(() => parseCurl("wget https://example.com")).toThrow(AuthError);
  });

  test("throws AuthError when no URL found", () => {
    expect(() => parseCurl("curl -H 'cookie: a=b'")).toThrow(AuthError);
  });

  test("returns empty userAgent when no user-agent header", () => {
    const result = parseCurl("curl 'https://example.com' -H 'accept: */*'");
    expect(result.userAgent).toBeUndefined();
  });

  test("returns empty cookies when no cookie header or -b flag", () => {
    const result = parseCurl(
      "curl 'https://example.com' -H 'accept: */*' -H 'user-agent: Mozilla/5.0'",
    );
    expect(Object.keys(result.cookies)).toHaveLength(0);
  });
});
