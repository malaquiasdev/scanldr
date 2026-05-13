import { describe, expect, test } from "bun:test";
import type { TraceStore } from "@plugins/trace/index.ts";
import { createLogger, type LogLevel } from "./index.ts";

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

function makeLogger(level: LogLevel, format: "human" | "json" = "human", traceStore?: TraceStore) {
  const sink = makeSink();
  const logger = createLogger(
    {
      level,
      format,
      write: sink.write,
      now: () => FIXED_TS,
    },
    traceStore,
  );
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
// Threshold tests use human format (default in makeLogger) with empty fields.

describe("createLogger — human format", () => {
  test("default format is human — emits `<ts> <level> <message>` only", () => {
    const { logger, sink } = makeLogger("info", "human");
    logger.info({}, "hello world");
    expect(sink.lines).toEqual([`${FIXED_TS} info hello world\n`]);
  });

  test("human format with fields emits ONLY `<ts> <level> <message>` — no JSON suffix", () => {
    const { logger, sink } = makeLogger("info", "human");
    logger.info({ attempt: 1, waitMs: 500 }, "retrying");
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toBe(`${FIXED_TS} info retrying\n`);
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
  test("--json opt-in still produces NDJSON with ts/level/msg/...fields", () => {
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

describe("createLogger — redaction (json format)", () => {
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

describe("createLogger — trace store injection", () => {
  function makeFakeStore() {
    const calls: Parameters<TraceStore["insert"]>[0][] = [];
    const store: TraceStore = {
      runId: "00000000-0000-4000-8000-000000000000",
      insert: (row) => calls.push(row),
      purge: () => {},
      close: () => {},
    };
    return { store, calls };
  }

  test("with injected trace store, every emit calls traceStore.insert", () => {
    const { store, calls } = makeFakeStore();
    const { logger } = makeLogger("info", "human", store);
    logger.info({ event: "test.event", x: 1 }, "hello");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.msg).toBe("hello");
    expect(calls[0]?.level).toBe("info");
    expect(calls[0]?.ts).toBe(FIXED_TS);
    expect(calls[0]?.event).toBe("test.event");
  });

  test("fields_json is set when fields are non-empty", () => {
    const { store, calls } = makeFakeStore();
    const { logger } = makeLogger("info", "human", store);
    logger.warn({ x: 42 }, "msg");
    expect(calls[0]?.fields_json).toBeDefined();
    const parsed = JSON.parse(calls[0]?.fields_json as string);
    expect(parsed.x).toBe(42);
  });

  test("fields_json is undefined when fields are empty", () => {
    const { store, calls } = makeFakeStore();
    const { logger } = makeLogger("info", "human", store);
    logger.info({}, "empty");
    expect(calls[0]?.fields_json).toBeUndefined();
  });

  test("without trace store, logger does not throw and still emits to terminal", () => {
    const { logger, sink } = makeLogger("info", "human");
    expect(() => logger.info({ x: 1 }, "no store")).not.toThrow();
    expect(sink.lines).toHaveLength(1);
  });

  test("trace store receives redacted fields_json", () => {
    const { store, calls } = makeFakeStore();
    const { logger } = makeLogger("info", "json", store);
    logger.info({ cookies: "secret", url: "ok" }, "req");
    const parsed = JSON.parse(calls[0]?.fields_json as string);
    expect(parsed.cookies).toBe("[REDACTED]");
    expect(parsed.url).toBe("ok");
  });
});
