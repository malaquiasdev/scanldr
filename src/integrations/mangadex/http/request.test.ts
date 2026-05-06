import { describe, expect, test } from "bun:test";
import { MangaDexHttpError, createMangaDexHttp } from "@integrations/mangadex/http/index.ts";
import type { Config } from "@plugins/config/index.ts";
import type { Logger } from "@plugins/logger/index.ts";

const noop = (_f: Record<string, unknown>, _m: string) => {};
const noopLogger: Logger = { error: noop, warn: noop, info: noop };
const baseConfig: Config = {
  preferred_languages: ["en"],
  download_quality: "data",
  default_format: "cbz",
  default_out: "./download",
  db_path: "./scanldr.db",
  image_concurrency: 4,
  chapter_delay_ms: 100,
};

describe("MangaDexHttpError", () => {
  test("instanceof Error and instanceof MangaDexHttpError both true", () => {
    const err = new MangaDexHttpError("MangaDex HTTP 404: /foo", 404);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MangaDexHttpError);
  });

  test("status field holds numeric status code", () => {
    const err = new MangaDexHttpError("MangaDex HTTP 404: /foo", 404);
    expect(err.status).toBe(404);
  });

  test("name is MangaDexHttpError", () => {
    const err = new MangaDexHttpError("MangaDex HTTP 404: /foo", 404);
    expect(err.name).toBe("MangaDexHttpError");
  });

  test("optional body field", () => {
    const err = new MangaDexHttpError("MangaDex HTTP 422: /foo", 422, "validation failed");
    expect(err.body).toBe("validation failed");
  });

  test("body is undefined when not provided", () => {
    const err = new MangaDexHttpError("MangaDex HTTP 404: /foo", 404);
    expect(err.body).toBeUndefined();
  });
});

describe("createMangaDexHttp — MangaDexHttpError on 4xx", () => {
  test("fetch returning 404 throws MangaDexHttpError with status 404", async () => {
    const client = createMangaDexHttp({
      logger: noopLogger,
      config: baseConfig,
      fetch: async () => new Response(null, { status: 404 }),
    });

    const err = await client.get("/not-found").catch((e) => e);
    expect(err).toBeInstanceOf(MangaDexHttpError);
    expect((err as MangaDexHttpError).status).toBe(404);
  });

  test("error message preserves MangaDex HTTP <status>: <url> format", async () => {
    const client = createMangaDexHttp({
      logger: noopLogger,
      config: baseConfig,
      fetch: async () => new Response(null, { status: 403 }),
    });

    const err = await client.get("/forbidden").catch((e) => e);
    expect(err).toBeInstanceOf(MangaDexHttpError);
    expect((err as MangaDexHttpError).message).toMatch(/^MangaDex HTTP 403:/);
  });
});
