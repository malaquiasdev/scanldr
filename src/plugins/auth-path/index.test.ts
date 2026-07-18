import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveAuthPath } from "./index.ts";

describe("resolveAuthPath — precedence", () => {
  test("opts.dataHome wins over everything else", () => {
    const path = resolveAuthPath({
      dataHome: "/custom/data",
      env: { XDG_DATA_HOME: "/xdg/data" },
      home: "/home/user",
    });
    expect(path).toBe(join("/custom/data", "scanldr", "auth.json"));
  });

  test("falls back to $XDG_DATA_HOME when dataHome is not set", () => {
    const path = resolveAuthPath({
      env: { XDG_DATA_HOME: "/xdg/data" },
      home: "/home/user",
    });
    expect(path).toBe(join("/xdg/data", "scanldr", "auth.json"));
  });

  test("falls back to <home>/.local/share when neither dataHome nor XDG_DATA_HOME set", () => {
    const path = resolveAuthPath({ env: {}, home: "/home/user" });
    expect(path).toBe(join("/home/user", ".local", "share", "scanldr", "auth.json"));
  });

  test("empty-string XDG_DATA_HOME is treated as unset", () => {
    const path = resolveAuthPath({ env: { XDG_DATA_HOME: "" }, home: "/home/user" });
    expect(path).toBe(join("/home/user", ".local", "share", "scanldr", "auth.json"));
  });

  test("always ends with scanldr/auth.json", () => {
    const path = resolveAuthPath({ dataHome: "/whatever", env: {}, home: "/home/user" });
    expect(path.endsWith(join("scanldr", "auth.json"))).toBe(true);
  });

  test("no options uses real process.env and os.homedir() without throwing", () => {
    expect(() => resolveAuthPath()).not.toThrow();
    const path = resolveAuthPath();
    expect(path.endsWith(join("scanldr", "auth.json"))).toBe(true);
  });
});
