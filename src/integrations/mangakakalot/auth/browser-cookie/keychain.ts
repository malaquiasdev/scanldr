// macOS Keychain shell seam. Isolated so tests never shell out to the real Keychain
// (which would trigger the OS "allow" prompt and be non-deterministic in CI).

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Reads a Keychain generic-password item by service name, e.g. "Opera Safe Storage".
 * Shells to `security find-generic-password -w -s "<serviceName>"`.
 * Throws if the item doesn't exist or the user denies the Keychain prompt.
 */
export async function readKeychainPassword(serviceName: string): Promise<string> {
  const { stdout } = await execFileAsync("security", [
    "find-generic-password",
    "-w",
    "-s",
    serviceName,
  ]);
  return stdout.trim();
}
