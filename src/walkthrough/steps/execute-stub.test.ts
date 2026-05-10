import { describe, expect, test } from "bun:test";
import type { Logger } from "../../plugins/logger/index.ts";
import { getSource } from "../../sources/index.ts";
import type { WalkthroughResult } from "../types.ts";
import { executePlan } from "./execute-stub.ts";

const source = getSource("mangadex");

const plan: WalkthroughResult = {
  title: "Naruto",
  source,
  hit: { id: "hit-1", title: "Naruto", originalLanguage: "ja", year: 1999 },
  mode: "chapter",
  selectedBundles: [{ label: "Chapter 1", id: "hit-1-ch-1" }],
  groupIntoVolume: true,
  coverUrl: "https://example.com/cover.jpg",
};

describe("executePlan", () => {
  test("logger.info called with event=walkthrough.plan_ready and plan fields", () => {
    const calls: { fields: Record<string, unknown>; msg: string }[] = [];

    const fakeLogger: Logger = {
      info: (fields: Record<string, unknown>, msg: string) => {
        calls.push({ fields, msg });
      },
      debug: () => {},
      warn: () => {},
      error: () => {},
      child: () => fakeLogger,
    } as unknown as Logger;

    executePlan(plan, fakeLogger);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error("No calls recorded");
    expect(call.fields.event).toBe("walkthrough.plan_ready");
    expect(call.fields.source).toBe("mangadex");
    expect(call.fields.title).toBe("Naruto");
    expect(call.fields.mode).toBe("chapter");
    expect(call.fields.bundles).toBe(1);
    expect(call.fields.groupIntoVolume).toBe(true);
  });

  test("returns input plan unchanged (no mutation)", () => {
    const noop = () => {};
    const fakeLogger = {
      info: noop,
      debug: noop,
      warn: noop,
      error: noop,
    } as unknown as Logger;

    const returned = executePlan(plan, fakeLogger);
    expect(returned).toBe(plan);
  });
});
