import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Config } from "@plugins/config/index.ts";
import { createLogger } from "@plugins/logger/index.ts";
import { getAdapter } from "./index.ts";

const noop = () => {};
const logger = createLogger({ level: "info", format: "human", write: noop });

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    preferred_languages: ["en"],
    download_quality: "data",
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

describe("getAdapter — config forwarding", () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: string | undefined;

  beforeEach(() => {
    capturedUrl = undefined;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("mangadex adapter created via getAdapter receives config (behavior differs by language)", async () => {
    // getAdapter builds the real client + http internally (no client DI seam exposed
    // publicly), so we intercept at the fetch boundary to prove config.preferred_languages
    // reaches the outgoing request built by the real client/http stack.
    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const config = makeConfig({ preferred_languages: ["pt-br"] });
    const adapter = getAdapter("mangadex", { logger, config });
    await adapter.listChapters("some-id");

    expect(capturedUrl).toContain("translatedLanguage");
    expect(capturedUrl).toContain("pt-br");
  });

  test("mangakakalot adapter created via getAdapter ignores config without throwing", () => {
    const config = makeConfig({ preferred_languages: ["pt-br"] });
    expect(() => getAdapter("mangakakalot", { logger, config })).not.toThrow();
    const adapter = getAdapter("mangakakalot", { logger, config });
    expect(typeof adapter.search).toBe("function");
    expect(typeof adapter.listChapters).toBe("function");
    expect(typeof adapter.listVolumes).toBe("function");
    expect(typeof adapter.fetchChapterInput).toBe("function");
  });
});
