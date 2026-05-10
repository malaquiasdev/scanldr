import { describe, expect, test } from "bun:test";
import { createLogger } from "@plugins/logger/index.ts";
import { getAdapter } from "./index.ts";

const noop = () => {};
const logger = createLogger({ level: "info", format: "human", write: noop });

describe("getAdapter", () => {
  test("returns an adapter for mangakakalot", () => {
    const adapter = getAdapter("mangakakalot", { logger });
    expect(typeof adapter.search).toBe("function");
    expect(typeof adapter.listChapters).toBe("function");
    expect(typeof adapter.listVolumes).toBe("function");
    expect(typeof adapter.fetchChapterInput).toBe("function");
  });

  test("returns an adapter for mangadex", () => {
    const adapter = getAdapter("mangadex", { logger });
    expect(typeof adapter.search).toBe("function");
    expect(typeof adapter.listChapters).toBe("function");
    expect(typeof adapter.listVolumes).toBe("function");
    expect(typeof adapter.fetchChapterInput).toBe("function");
  });

  test("throws on unknown source id", () => {
    expect(() => getAdapter("unknown-source", { logger })).toThrow(
      /No adapter registered for source/,
    );
  });
});
