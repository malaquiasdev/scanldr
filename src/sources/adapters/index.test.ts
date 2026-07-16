import { describe, expect, test } from "bun:test";
import type { Config } from "@plugins/config/index.ts";
import { createLogger } from "@plugins/logger/index.ts";
import { getAdapter } from "./index.ts";

const noop = () => {};
const logger = createLogger({ level: "info", format: "human", write: noop });

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    default_format: "cbz",
    default_out: ".",
    db_path: "",
    image_concurrency: 4,
    chapter_delay_ms: 500,
    ...overrides,
  };
}

describe("getAdapter", () => {
  test("returns an adapter for mangakakalot", () => {
    const adapter = getAdapter("mangakakalot", { logger });
    expect(typeof adapter.search).toBe("function");
    expect(typeof adapter.listChapters).toBe("function");
    expect(typeof adapter.fetchChapterInput).toBe("function");
  });

  test("throws on unknown source id", () => {
    expect(() => getAdapter("unknown-source", { logger })).toThrow(
      /No adapter registered for source/,
    );
  });
});

describe("getAdapter — config forwarding", () => {
  test("mangakakalot adapter created via getAdapter ignores config without throwing", () => {
    const config = makeConfig();
    expect(() => getAdapter("mangakakalot", { logger, config })).not.toThrow();
    const adapter = getAdapter("mangakakalot", { logger, config });
    expect(typeof adapter.search).toBe("function");
    expect(typeof adapter.listChapters).toBe("function");
    expect(typeof adapter.fetchChapterInput).toBe("function");
  });
});
