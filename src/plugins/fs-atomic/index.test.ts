import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite } from "./index.ts";

const dirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fs-atomic-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("atomicWrite", () => {
  test("writes string data and renames into place, cleaning up the tmp file", async () => {
    const dir = await makeTmpDir();
    const target = join(dir, "session.json");

    await atomicWrite(target, JSON.stringify({ a: 1 }), { encoding: "utf8", mode: 0o600 });

    expect(existsSync(target)).toBe(true);
    expect(existsSync(`${target}.tmp`)).toBe(false);
    expect(await readFile(target, "utf8")).toBe(JSON.stringify({ a: 1 }));
  });

  test("writes binary data (Uint8Array) with a custom tmp suffix", async () => {
    const dir = await makeTmpDir();
    const target = join(dir, "volume.cbz");
    const bytes = new Uint8Array([1, 2, 3, 4]);

    await atomicWrite(target, bytes, { mode: 0o644, tmpSuffix: ".temp" });

    expect(existsSync(target)).toBe(true);
    expect(existsSync(`${target}.temp`)).toBe(false);
    const written = await readFile(target);
    expect(new Uint8Array(written)).toEqual(bytes);
  });

  test("cleans up the tmp file and rethrows when rename fails", async () => {
    const dir = await makeTmpDir();
    // A directory as the destination guarantees rename() fails (EISDIR/ENOTEMPTY),
    // while writeFile() to the tmp path still succeeds.
    const target = join(dir, "collides");
    await mkdir(target);

    await expect(atomicWrite(target, "data")).rejects.toBeTruthy();

    expect(existsSync(`${target}.tmp`)).toBe(false);
    // Original directory untouched.
    expect(existsSync(target)).toBe(true);
  });

  test("leaves no tmp file behind when writeFile itself fails", async () => {
    const dir = await makeTmpDir();
    // Writing to a path inside a non-existent subdirectory fails at writeFile time.
    const target = join(dir, "missing-subdir", "file.txt");

    await expect(atomicWrite(target, "data")).rejects.toBeTruthy();

    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  test("applies mode 0o600 exactly to the resulting file (auth/credentials guarantee)", async () => {
    const dir = await makeTmpDir();
    const target = join(dir, "credentials.json");

    await atomicWrite(target, JSON.stringify({ token: "secret" }), { mode: 0o600 });

    const { mode } = await stat(target);
    expect(mode & 0o777).toBe(0o600);
  });

  test("cleans up the tmp file when rename fails even with a restrictive mode", async () => {
    const dir = await makeTmpDir();
    // A directory as the destination guarantees rename() fails (EISDIR/ENOTEMPTY),
    // while writeFile() to the tmp path still succeeds.
    const target = join(dir, "collides-restrictive");
    await mkdir(target);

    await expect(atomicWrite(target, "secret", { mode: 0o600 })).rejects.toBeTruthy();

    expect(existsSync(`${target}.tmp`)).toBe(false);
    expect(existsSync(target)).toBe(true);
  });
});
