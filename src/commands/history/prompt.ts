// Confirmation prompt logic for history clear — writes to process.stderr.

import { createInterface } from "node:readline";

/** Ask y/N confirmation. Returns true if user confirmed. */
export function promptYesNo(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write(`${message} [y/N] `);
    rl.once("line", (line) => {
      rl.close();
      resolve(line.trim().toLowerCase() === "y");
    });
  });
}

/** Ask the user to type DELETE explicitly. Returns true if they typed it. */
export function promptTypeDelete(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write(`${message}\nType DELETE to confirm: `);
    rl.once("line", (line) => {
      rl.close();
      resolve(line.trim() === "DELETE");
    });
  });
}
