import { describe, expect, test } from "bun:test";
import { type LogLevel, createLogger } from "./index.ts";

const FIXED_TS = "2025-01-01T00:00:00.000Z";

function makeSink() {
  const lines: string[] = [];
  return {
    lines,
    write: (line: string) => {
      lines.push(line);
    },
  };
}

function makeLogger(level: LogLevel, format: "human" | "json" = "human") {
  const sink = makeSink();
  const logger = createLogger({
    level,
    format,
    write: sink.write,
    now: () => FIXED_TS,
  });
  return { logger, sink };
}

describe("createLogger — thresholds", () => {
  test("default info: shows error/warn/info, hides debug", () => {
    const { logger, sink } = makeLogger("info");
    logger.error({}, "e");
    logger.warn({}, "w");
    logger.info({}, "i");
    logger.debug({}, "d");
    expect(sink.lines).toEqual([
      `${FIXED_TS} error e\n`,
      `${FIXED_TS} warn w\n`,
      `${FIXED_TS} info i\n`,
    ]);
  });

  test("error threshold: only error", () => {
    const { logger, sink } = makeLogger("error");
    logger.error({}, "e");
    logger.warn({}, "w");
    logger.info({}, "i");
    logger.debug({}, "d");
    expect(sink.lines).toEqual([`${FIXED_TS} error e\n`]);
  });

  test("warn threshold (--quiet): error + warn only", () => {
    const { logger, sink } = makeLogger("warn");
    logger.error({}, "e");
    logger.warn({}, "w");
    logger.info({}, "i");
    logger.debug({}, "d");
    expect(sink.lines).toEqual([`${FIXED_TS} error e\n`, `${FIXED_TS} warn w\n`]);
  });

  test("debug threshold (--verbose): all four", () => {
    const { logger, sink } = makeLogger("debug");
    logger.error({}, "e");
    logger.warn({}, "w");
    logger.info({}, "i");
    logger.debug({}, "d");
    expect(sink.lines).toHaveLength(4);
    expect(sink.lines[3]).toBe(`${FIXED_TS} debug d\n`);
  });
});

describe("createLogger — human format", () => {
  test("emits `<ts> <level> <message>`", () => {
    const { logger, sink } = makeLogger("info", "human");
    logger.info({}, "hello world");
    expect(sink.lines).toEqual([`${FIXED_TS} info hello world\n`]);
  });

  test("ignores fields in human format (no parsing of free-form)", () => {
    const { logger, sink } = makeLogger("info", "human");
    logger.info({ foo: "bar", cookies: "secret" }, "msg");
    expect(sink.lines).toEqual([`${FIXED_TS} info msg\n`]);
  });
});

describe("createLogger — json format", () => {
  test("emits NDJSON with ts/level/msg/...fields", () => {
    const { logger, sink } = makeLogger("info", "json");
    logger.info({ port: 3000 }, "ready");
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]?.endsWith("\n")).toBe(true);
    const obj = JSON.parse(sink.lines[0] as string);
    expect(obj).toEqual({ ts: FIXED_TS, level: "info", msg: "ready", port: 3000 });
  });

  test("each call produces exactly one newline-delimited line", () => {
    const { logger, sink } = makeLogger("debug", "json");
    logger.error({}, "a");
    logger.debug({}, "b");
    expect(sink.lines).toHaveLength(2);
    for (const line of sink.lines) {
      expect(line.endsWith("\n")).toBe(true);
      expect(line.indexOf("\n")).toBe(line.length - 1);
    }
  });
});

describe("createLogger — redaction", () => {
  test("redacts top-level cookies / Authorization / userAgent / cf_clearance", () => {
    const { logger, sink } = makeLogger("debug", "json");
    logger.debug(
      {
        cookies: { cf_clearance: "abc", session: "xyz" },
        Authorization: "Bearer token",
        userAgent: "Mozilla/5.0",
        url: "https://example.com",
      },
      "req",
    );
    const obj = JSON.parse(sink.lines[0] as string);
    expect(obj.cookies).toBe("[REDACTED]");
    expect(obj.Authorization).toBe("[REDACTED]");
    expect(obj.userAgent).toBe("[REDACTED]");
    expect(obj.url).toBe("https://example.com");
  });

  test("redacts denylisted keys recursively in nested objects", () => {
    const { logger, sink } = makeLogger("debug", "json");
    logger.debug(
      {
        request: {
          headers: {
            Authorization: "Bearer token",
            "X-Custom": "ok",
          },
          meta: {
            cf_clearance: "raw-cookie",
          },
        },
      },
      "nested",
    );
    const obj = JSON.parse(sink.lines[0] as string);
    expect(obj.request.headers.Authorization).toBe("[REDACTED]");
    expect(obj.request.headers["X-Custom"]).toBe("ok");
    expect(obj.request.meta.cf_clearance).toBe("[REDACTED]");
  });

  test("redacts inside arrays of objects", () => {
    const { logger, sink } = makeLogger("debug", "json");
    logger.debug(
      {
        requests: [
          { url: "/a", Authorization: "t1" },
          { url: "/b", cookies: { cf_clearance: "c" } },
        ],
      },
      "arr",
    );
    const obj = JSON.parse(sink.lines[0] as string);
    expect(obj.requests[0].Authorization).toBe("[REDACTED]");
    expect(obj.requests[0].url).toBe("/a");
    expect(obj.requests[1].cookies).toBe("[REDACTED]");
  });

  test("denylist match is case-insensitive on key name", () => {
    const { logger, sink } = makeLogger("debug", "json");
    logger.debug(
      {
        AUTHORIZATION: "x",
        Cookies: "y",
        UserAgent: "z",
        CF_CLEARANCE: "w",
      },
      "ci",
    );
    const obj = JSON.parse(sink.lines[0] as string);
    expect(obj.AUTHORIZATION).toBe("[REDACTED]");
    expect(obj.Cookies).toBe("[REDACTED]");
    expect(obj.UserAgent).toBe("[REDACTED]");
    expect(obj.CF_CLEARANCE).toBe("[REDACTED]");
  });
});
