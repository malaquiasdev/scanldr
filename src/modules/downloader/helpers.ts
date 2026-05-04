export function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function detectExtFromBytes(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return ".png";
  return null;
}

/**
 * Pads only the integer part of a bundle number to `width` digits.
 * Preserves the decimal portion unchanged.
 * Non-numeric tokens (e.g. "none") pass through unchanged.
 *
 * Examples:
 *   "1"    → "001"
 *   "18.5" → "018.5"
 *   "103"  → "103"
 *   "none" → "none"
 */
export function padBundleNumber(value: string, width: number): string {
  const dotIdx = value.indexOf(".");
  if (dotIdx === -1) {
    // No decimal: try to pad as integer
    const n = Number(value);
    if (Number.isNaN(n)) return value;
    return String(n).padStart(width, "0");
  }
  const intPart = value.slice(0, dotIdx);
  const decPart = value.slice(dotIdx); // includes the dot
  const n = Number(intPart);
  if (Number.isNaN(n)) return value;
  return String(n).padStart(width, "0") + decPart;
}
