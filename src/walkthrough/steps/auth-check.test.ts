import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../plugins/logger/index.ts";

const noop = () => {};
const logger = createLogger({ level: "info", format: "human", write: noop });

describe("checkAuth", () => {
  test("requiresAuth: false → returns { ok: true, skipped: true } without prompting", async () => {
    let promptCalled = false;
    mock.module("../prompts.ts", () => ({
      editor: async () => {
        promptCalled = true;
        return "";
      },
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));
    const { checkAuth } = await import("./auth-check.ts");
    const result = await checkAuth({ requiresAuth: false, logger });
    expect(result).toEqual({ ok: true, skipped: true });
    expect(promptCalled).toBe(false);
  });

  test("requiresAuth: true with existing valid auth → returns { ok: true, skipped: false } without prompting", async () => {
    const dir = join(tmpdir(), `scanldr-test-${Date.now()}`);
    const authDir = join(dir, "scanldr");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(join(authDir, "auth.json"), JSON.stringify({ token: "abc" }));

    let promptCalled = false;
    mock.module("../prompts.ts", () => ({
      editor: async () => {
        promptCalled = true;
        return "";
      },
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));

    const { checkAuth } = await import("./auth-check.ts");
    const result = await checkAuth({ requiresAuth: true, logger, dataHome: dir });
    expect(result).toEqual({ ok: true, skipped: false });
    expect(promptCalled).toBe(false);
  });

  test("requiresAuth: true, no auth file, valid cURL paste → returns { ok: true, skipped: false, justAuthenticated: true }", async () => {
    const tmpDir = join(tmpdir(), `scanldr-auth-test-${Date.now()}`);
    mock.module("../prompts.ts", () => ({
      editor: async () => "curl 'https://example.com' -H 'Cookie: cf_clearance=abc; session=xyz'",
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));

    const { checkAuth } = await import("./auth-check.ts");
    const result = await checkAuth({ requiresAuth: true, logger, dataHome: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.justAuthenticated).toBe(true);
  });

  test("requiresAuth: true, invalid paste (no cookies) — exhausts 2 retries then throws WalkthroughError", async () => {
    let callCount = 0;
    mock.module("../prompts.ts", () => ({
      editor: async () => {
        callCount++;
        return "curl 'https://example.com' -H 'Accept: */*'"; // no cookie header
      },
      input: async () => "",
      select: async () => "",
      checkbox: async () => [],
      confirm: async () => false,
    }));

    const { checkAuth } = await import("./auth-check.ts");
    await expect(
      checkAuth({ requiresAuth: true, logger, dataHome: "/nonexistent/path" }),
    ).rejects.toThrow(/attempt/i);
    expect(callCount).toBe(2);
  });
});
