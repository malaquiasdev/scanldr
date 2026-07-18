import { describe, expect, test } from "bun:test";
import type { BrowserContext } from "../../integrations/mangakakalot/auth/browser-capture/types.ts";
import type { BrowserCaptureDeps } from "../types.ts";
import { withCaptureOnce } from "./capture-once.ts";

function makeFakeContext(): BrowserContext {
  return {
    goto: async () => {},
    waitForChallengeCleared: async () => {},
    cookies: async () => [],
    userAgent: async () => "fake-ua",
    close: async () => {},
  };
}

function fakeDeps(result: BrowserContext | undefined) {
  let calls = 0;
  const deps: BrowserCaptureDeps = {
    launcherDeps: {
      launch: async () => {
        calls += 1;
        return result;
      },
    },
  };
  return { deps, getCalls: () => calls };
}

describe("withCaptureOnce", () => {
  test("first invocation delegates to the wrapped launcher", async () => {
    const ctx = makeFakeContext();
    const { deps, getCalls } = fakeDeps(ctx);
    const wrapped = withCaptureOnce(deps);
    const result = await wrapped.launcherDeps.launch();
    expect(result).toBe(ctx);
    expect(getCalls()).toBe(1);
  });

  test("second invocation after success returns undefined without calling launcher again", async () => {
    const { deps, getCalls } = fakeDeps(makeFakeContext());
    const wrapped = withCaptureOnce(deps);
    await wrapped.launcherDeps.launch();
    const second = await wrapped.launcherDeps.launch();
    expect(second).toBeUndefined();
    expect(getCalls()).toBe(1);
  });

  test("second invocation after failed launch (undefined) also short-circuits", async () => {
    const { deps, getCalls } = fakeDeps(undefined);
    const wrapped = withCaptureOnce(deps);
    const first = await wrapped.launcherDeps.launch();
    const second = await wrapped.launcherDeps.launch();
    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(getCalls()).toBe(1);
  });

  test("multiple wrapped instances have independent state", async () => {
    const ctxA = makeFakeContext();
    const ctxB = makeFakeContext();
    const { deps: depsA, getCalls: callsA } = fakeDeps(ctxA);
    const { deps: depsB, getCalls: callsB } = fakeDeps(ctxB);
    const wrappedA = withCaptureOnce(depsA);
    const wrappedB = withCaptureOnce(depsB);
    await wrappedA.launcherDeps.launch();
    expect(callsA()).toBe(1);
    expect(callsB()).toBe(0);
    const resultB = await wrappedB.launcherDeps.launch();
    expect(resultB).toBe(ctxB);
    expect(callsB()).toBe(1);
  });

  test("concurrent calls before the first resolves still each trigger the underlying launcher (no in-flight dedupe)", async () => {
    let calls = 0;
    const ctx = makeFakeContext();
    const deps: BrowserCaptureDeps = {
      launcherDeps: {
        launch: async () => {
          calls += 1;
          await new Promise((r) => setTimeout(r, 5));
          return ctx;
        },
      },
    };
    const wrapped = withCaptureOnce(deps);
    const [r1, r2] = await Promise.all([
      wrapped.launcherDeps.launch(),
      wrapped.launcherDeps.launch(),
    ]);
    // hasAttempted flips synchronously before the await, so only one call reaches the launcher.
    expect(calls).toBe(1);
    expect([r1, r2].filter((r) => r === ctx)).toHaveLength(1);
    expect([r1, r2].filter((r) => r === undefined)).toHaveLength(1);
  });
});
