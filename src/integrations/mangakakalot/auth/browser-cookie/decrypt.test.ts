import { describe, expect, test } from "bun:test";
import { createCipheriv } from "node:crypto";
import { decryptV10, deriveKey } from "./decrypt.ts";

const FIXTURE_PASSWORD = "fixture-keychain-password";
const IV = Buffer.alloc(16, 0x20);

/** Encrypts a plaintext with the same v10 params, for round-trip tests. */
function encryptV10(plaintext: string, password: string): Uint8Array {
  const key = deriveKey(password);
  const cipher = createCipheriv("aes-128-cbc", key, IV);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("v10", "ascii"), encrypted]);
}

describe("decryptV10", () => {
  test("round-trips a plain value (no domain-hash prefix)", () => {
    const blob = encryptV10("this-is-a-cf_clearance-token-value", FIXTURE_PASSWORD);
    expect(decryptV10(blob, FIXTURE_PASSWORD)).toBe("this-is-a-cf_clearance-token-value");
  });

  test("strips a leading 32-byte non-printable domain-hash prefix", () => {
    const domainHash = Buffer.alloc(32, 0x00); // non-printable bytes
    const plaintext = `${domainHash.toString("binary")}real-cf-token`;
    const blob = encryptV10(plaintext, FIXTURE_PASSWORD);
    expect(decryptV10(blob, FIXTURE_PASSWORD)).toBe("real-cf-token");
  });

  test("throws on non-v10 prefix", () => {
    const blob = Buffer.from("v11somejunkbytesxx");
    expect(() => decryptV10(blob, FIXTURE_PASSWORD)).toThrow(/unsupported cookie encryption/);
  });

  test("wrong password yields garbage, not a throw (autoPadding disabled)", () => {
    const blob = encryptV10("real-value", FIXTURE_PASSWORD);
    const result = decryptV10(blob, "wrong-password");
    expect(result).not.toBe("real-value");
  });
});
