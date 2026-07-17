// Chromium "v10" cookie decryption (macOS). Standard scheme shared by Chrome/Opera/Brave/Edge:
// key = PBKDF2(sha1, password=<Keychain Safe Storage>, salt="saltysalt", 1003 iters, 16 bytes)
// AES-128-CBC, IV = 16 bytes of 0x20, ciphertext = encrypted_value[3:] (after the "v10" prefix).
// See docs/discovery/cf-cookie-autoextract-feasibility.md for the verified live spike.

import { createDecipheriv, pbkdf2Sync } from "node:crypto";

const SALT = "saltysalt";
const ITERATIONS = 1003;
const KEY_LENGTH = 16;
const IV = Buffer.alloc(16, 0x20);
const V10_PREFIX = "v10";

/** Derives the AES-128 key from the Keychain "Safe Storage" password. */
export function deriveKey(password: string): Buffer {
  return pbkdf2Sync(password, SALT, ITERATIONS, KEY_LENGTH, "sha1");
}

/** Strips PKCS7 padding. Returns the input unchanged if the padding byte is out of range. */
function stripPkcs7(buf: Buffer): Buffer {
  if (buf.length === 0) return buf;
  const padLen = buf.at(-1) ?? 0;
  if (padLen < 1 || padLen > 16 || padLen > buf.length) return buf;
  return buf.subarray(0, buf.length - padLen);
}

/** True when every byte is printable ASCII (0x20-0x7e). */
function isPrintableAscii(buf: Buffer): boolean {
  for (const byte of buf) {
    if (byte < 0x20 || byte > 0x7e) return false;
  }
  return true;
}

/**
 * Decrypts a Chromium `v10`-scheme `encrypted_value` blob into the plaintext cookie value.
 * Newer Chromium builds prepend a 32-byte SHA256 domain-hash before the plaintext — detected
 * and stripped when the leading 32 bytes aren't printable ASCII.
 *
 * Throws if the blob isn't `v10`-prefixed.
 */
export function decryptV10(encryptedValue: Uint8Array, password: string): string {
  const buf = Buffer.from(encryptedValue);
  const prefix = buf.subarray(0, 3).toString("ascii");
  if (prefix !== V10_PREFIX) {
    throw new Error(`unsupported cookie encryption scheme: expected "v10", got "${prefix}"`);
  }

  const key = deriveKey(password);
  const ciphertext = buf.subarray(3);

  const decipher = createDecipheriv("aes-128-cbc", key, IV);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  const unpadded = stripPkcs7(decrypted);

  // Heuristic: a mis-strip here is astronomically unlikely, and even if it happened the
  // downstream probe → manual-paste fallback catches it (a wrong session is never surfaced).
  if (unpadded.length > 32 && !isPrintableAscii(unpadded.subarray(0, 32))) {
    return unpadded.subarray(32).toString("utf8");
  }

  return unpadded.toString("utf8");
}
