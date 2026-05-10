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
  test("info: shows error/warn/info", () => {
    const { logger, sink } = makeLogger("info");
    logger.error({}, "e");
    logger.warn({}, "w");
    logger.info({}, "i");
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
    expect(sink.lines).toEqual([`${FIXED_TS} error e\n`]);
  });

  test("warn threshold: error + warn only", () => {
    const { logger, sink } = makeLogger("warn");
    logger.error({}, "e");
    logger.warn({}, "w");
    logger.info({}, "i");
    expect(sink.lines).toEqual([`${FIXED_TS} error e\n`, `${FIXED_TS} warn w\n`]);
  });
});
// Threshold tests use human format (default in makeLogger) with empty fields,
// so they exercise the no-trailing-artefact path.

describe("createLogger — human format", () => {
  test("emits `<ts> <level> <message>` with no trailing artefact when fields are empty", () => {
    const { logger, sink } = makeLogger("info", "human");
    logger.info({}, "hello world");
    expect(sink.lines).toEqual([`${FIXED_TS} info hello world\n`]);
  });

  test("appends JSON fields after message", () => {
    const { logger, sink } = makeLogger("info", "human");
    logger.info({ attempt: 1, waitMs: 500 }, "retrying");
    expect(sink.lines).toHaveLength(1);
    const line = sink.lines[0] as string;
    expect(line.startsWith(`${FIXED_TS} info retrying `)).toBe(true);
    expect(line.endsWith("\n")).toBe(true);
    const fieldsStr = line.slice(`${FIXED_TS} info retrying `.length, -1);
    expect(JSON.parse(fieldsStr)).toEqual({ attempt: 1, waitMs: 500 });
  });

  test("redacts cookies/cf_clearance/useragent/authorization in human format", () => {
    const { logger, sink } = makeLogger("info", "human");
    logger.info({ cookies: "secret", url: "https://example.com" }, "req");
    const line = sink.lines[0] as string;
    const fieldsStr = line.slice(`${FIXED_TS} info req `.length, -1);
    const obj = JSON.parse(fieldsStr);
    expect(obj.cookies).toBe("[REDACTED]");
    expect(obj.url).toBe("https://example.com");
  });

  test("redacts cf_clearance in human format", () => {
    const { logger, sink } = makeLogger("info", "human");
    logger.info({ cf_clearance: "abcd1234efgh5678" }, "req");
    const line = sink.lines[0] as string;
    expect(line).toContain("[REDACTED]");
    expect(line).not.toContain("abcd1234efgh5678");
  });

  test("redacts useragent in human format", () => {
    const { logger, sink } = makeLogger("info", "human");
    logger.info({ useragent: "Mozilla/5.0 (Windows NT 10.0)" }, "req");
    const line = sink.lines[0] as string;
    expect(line).toContain("[REDACTED]");
    expect(line).not.toContain("Mozilla/5.0 (Windows NT 10.0)");
  });

  test("redacts authorization in human format", () => {
    const { logger, sink } = makeLogger("info", "human");
    logger.info({ authorization: "Bearer eyJhbGciOiJIUzI1NiJ9" }, "req");
    const line = sink.lines[0] as string;
    expect(line).toContain("[REDACTED]");
    expect(line).not.toContain("Bearer eyJhbGciOiJIUzI1NiJ9");
  });

  test("empty fields object emits no trailing space or empty object", () => {
    const { logger, sink } = makeLogger("info", "human");
    logger.warn({}, "clean");
    expect(sink.lines[0]).toBe(`${FIXED_TS} warn clean\n`);
  });

  test("each human call is exactly one newline-delimited line", () => {
    const { logger, sink } = makeLogger("info", "human");
    logger.error({ x: 1 }, "a");
    logger.warn({}, "b");
    expect(sink.lines).toHaveLength(2);
    for (const line of sink.lines) {
      expect(line.endsWith("\n")).toBe(true);
      expect(line.indexOf("\n")).toBe(line.length - 1);
    }
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
    const { logger, sink } = makeLogger("info", "json");
    logger.error({}, "a");
    logger.warn({}, "b");
    expect(sink.lines).toHaveLength(2);
    for (const line of sink.lines) {
      expect(line.endsWith("\n")).toBe(true);
      expect(line.indexOf("\n")).toBe(line.length - 1);
    }
  });
});

describe("createLogger — redaction", () => {
  test("redacts top-level cookies / Authorization / userAgent / cf_clearance", () => {
    const { logger, sink } = makeLogger("warn", "json");
    logger.warn(
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
    const { logger, sink } = makeLogger("warn", "json");
    logger.warn(
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
    const { logger, sink } = makeLogger("warn", "json");
    logger.warn(
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
    const { logger, sink } = makeLogger("warn", "json");
    logger.warn(
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
