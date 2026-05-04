import { describe, expect, test } from "bun:test";
import { toSlug } from "./slug.ts";

describe("toSlug", () => {
  test("simple ASCII title", () => {
    expect(toSlug("Berserk")).toBe("berserk");
  });

  test("title with colon and apostrophe", () => {
    expect(toSlug("One Piece: Pirate's Tale")).toBe("one-piece-pirate-s-tale");
  });

  test("title with em-dash and non-ASCII script stripped", () => {
    // Korean part is stripped to nothing, leaving only the ASCII portion
    expect(toSlug("Solo Leveling — 나 혼자만 레벨업")).toBe("solo-leveling");
  });

  test("accented character normalized", () => {
    expect(toSlug("Vão")).toBe("vao");
  });

  test("all-non-ASCII title falls back to 'untitled'", () => {
    const warnMsgs: string[] = [];
    const logger = {
      warn: (_obj: Record<string, unknown>, msg: string) => {
        warnMsgs.push(msg);
      },
    };
    expect(toSlug("나 혼자만", logger)).toBe("untitled");
    expect(warnMsgs.length).toBe(1);
  });

  test("empty string falls back to 'untitled'", () => {
    expect(toSlug("")).toBe("untitled");
  });
});
