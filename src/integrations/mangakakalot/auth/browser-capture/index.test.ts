import { describe, expect, test } from "bun:test";
import { createLogger } from "../../../../plugins/logger/index.ts";
import { captureSessionViaBrowser } from "./index.ts";
import type { BrowserContext, BrowserLauncherDeps } from "./types.ts";

const noop = () => {};
const logger = createLogger({ level: "info", format: "human", write: noop });

describe("captureSessionViaBrowser", () => {
  test("successful capture", async () => {
    const mockContext: BrowserContext = {
      goto: async () => {},
      waitForChallengeCleared: async () => {},
      cookies: async () => [
        { name: "cf_clearance", value: "abc" },
        { name: "other", value: "xyz" },
      ],
      userAgent: async () => "fake-ua",
      close: async () => {},
    };

    const launcherDeps: BrowserLauncherDeps = {
      launch: async () => mockContext,
    };

    const result = await captureSessionViaBrowser(launcherDeps, "https://example.com", logger);
    expect(result).toEqual({
      cookies: {
        cf_clearance: "abc",
        other: "xyz",
      },
      userAgent: "fake-ua",
    });
  });

  test("no Chrome available", async () => {
    let loggedInfo = false;
    const testLogger = createLogger({
      level: "info",
      format: "json",
      write: (chunk) => {
        if (chunk.includes("walkthrough.auth_capture_no_chrome")) {
          loggedInfo = true;
        }
      },
    });

    const launcherDeps: BrowserLauncherDeps = {
      launch: async () => undefined,
    };

    const result = await captureSessionViaBrowser(launcherDeps, "https://example.com", testLogger);
    expect(result).toBeUndefined();
    expect(loggedInfo).toBe(true);
  });

  test("CF challenge poll timeout", async () => {
    let loggedWarn = false;
    const testLogger = createLogger({
      level: "info",
      format: "json",
      write: (chunk) => {
        if (chunk.includes("walkthrough.auth_capture_failed")) {
          loggedWarn = true;
        }
      },
    });

    const mockContext: BrowserContext = {
      goto: async () => {},
      waitForChallengeCleared: async () => {
        throw new Error("timeout waiting for challenge");
      },
      cookies: async () => [],
      userAgent: async () => "",
      close: async () => {},
    };

    const launcherDeps: BrowserLauncherDeps = {
      launch: async () => mockContext,
    };

    const result = await captureSessionViaBrowser(launcherDeps, "https://example.com", testLogger);
    expect(result).toBeUndefined();
    expect(loggedWarn).toBe(true);
  });

  test("close() error (best-effort cleanup)", async () => {
    let loggedError = false;
    const testLogger = createLogger({
      level: "info",
      format: "json",
      write: (chunk) => {
        if (chunk.includes("walkthrough.auth_capture_close_failed")) {
          loggedError = true;
        }
      },
    });

    const mockContext: BrowserContext = {
      goto: async () => {},
      waitForChallengeCleared: async () => {},
      cookies: async () => [{ name: "cf_clearance", value: "abc" }],
      userAgent: async () => "fake-ua",
      close: async () => {
        throw new Error("close failed");
      },
    };

    const launcherDeps: BrowserLauncherDeps = {
      launch: async () => mockContext,
    };

    const result = await captureSessionViaBrowser(launcherDeps, "https://example.com", testLogger);
    expect(result).toEqual({
      cookies: {
        cf_clearance: "abc",
      },
      userAgent: "fake-ua",
    });
    expect(loggedError).toBe(true);
  });
});
