export function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function detectExtFromBytes(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return ".png";
  return null;
}
