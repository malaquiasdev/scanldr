import { describe, expect, test } from "bun:test";
import {
  CloudflareError,
  CrossOriginCloudflareError,
} from "../integrations/fallback-http/types.ts";
import type { Logger } from "../plugins/logger/index.ts";
import { WalkthroughError } from "./types.ts";
import { isCloudflareError, withSessionRetry } from "./with-session-retry.ts";

function makeLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

describe("isCloudflareError", () => {
  test("matches CloudflareError", () => {
    expect(isCloudflareError(new CloudflareError("https://example.com"))).toBe(true);
  });

  test("does NOT match CrossOriginCloudflareError (issue #137)", () => {
    expect(isCloudflareError(new CrossOriginCloudflareError("https://cdn.example.com"))).toBe(
      false,
    );
  });

  test("does not match unrelated errors", () => {
    expect(isCloudflareError(new Error("boom"))).toBe(false);
  });
});

describe("withSessionRetry", () => {
  test("refreshes and retries on a stale-session CloudflareError", async () => {
    let refreshCalled = 0;
    let attempt = 0;
    const fn = async () => {
      attempt++;
      if (attempt === 1) throw new CloudflareError("https://example.com");
      return "ok";
    };
    const refresh = async () => {
      refreshCalled++;
    };

    const result = await withSessionRetry(
      fn,
      isCloudflareError,
      refresh,
      makeLogger(),
      "test.event",
    );
    expect(result).toBe("ok");
    expect(refreshCalled).toBe(1);
  });

  test("throws WalkthroughError when CF persists after refresh", async () => {
    const fn = async () => {
      throw new CloudflareError("https://example.com");
    };
    const refresh = async () => {};

    await expect(
      withSessionRetry(fn, isCloudflareError, refresh, makeLogger(), "test.event"),
    ).rejects.toBeInstanceOf(WalkthroughError);
  });

  test("does NOT call refresh() for CrossOriginCloudflareError — throws WalkthroughError immediately", async () => {
    let refreshCalled = 0;
    let fnCalls = 0;
    const fn = async () => {
      fnCalls++;
      throw new CrossOriginCloudflareError("https://cdn.example.com/img.webp");
    };
    const refresh = async () => {
      refreshCalled++;
    };

    await expect(
      withSessionRetry(fn, isCloudflareError, refresh, makeLogger(), "test.event"),
    ).rejects.toBeInstanceOf(WalkthroughError);

    expect(refreshCalled).toBe(0);
    expect(fnCalls).toBe(1);
  });

  test("CrossOriginCloudflareError message points to Referer/CDN config, not session staleness", async () => {
    const fn = async () => {
      throw new CrossOriginCloudflareError("https://cdn.example.com/img.webp");
    };
    const refresh = async () => {};

    try {
      await withSessionRetry(fn, isCloudflareError, refresh, makeLogger(), "test.event");
      throw new Error("expected withSessionRetry to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WalkthroughError);
      const message = (err as Error).message;
      expect(message).toMatch(/referer|cdn/i);
      expect(message).not.toMatch(/paste a new cURL|try again later/i);
    }
  });

  test("post-refresh retry hitting CrossOriginCloudflareError throws WalkthroughError without a second refresh", async () => {
    let refreshCalled = 0;
    let attempt = 0;
    const fn = async () => {
      attempt++;
      if (attempt === 1) throw new CloudflareError("https://example.com");
      throw new CrossOriginCloudflareError("https://cdn.example.com/img.webp");
    };
    const refresh = async () => {
      refreshCalled++;
    };

    await expect(
      withSessionRetry(fn, isCloudflareError, refresh, makeLogger(), "test.event"),
    ).rejects.toBeInstanceOf(WalkthroughError);

    // Only the first (stale-session) CF error triggers a refresh; the second
    // attempt's CrossOriginCloudflareError is surfaced immediately (with-session-retry.ts:47-52).
    expect(refreshCalled).toBe(1);
    expect(attempt).toBe(2);
  });

  test("re-throws unrelated errors without calling refresh", async () => {
    let refreshCalled = 0;
    const fn = async () => {
      throw new Error("network down");
    };
    const refresh = async () => {
      refreshCalled++;
    };

    await expect(
      withSessionRetry(fn, isCloudflareError, refresh, makeLogger(), "test.event"),
    ).rejects.toThrow("network down");
    expect(refreshCalled).toBe(0);
  });
});
