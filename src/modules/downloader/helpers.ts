export function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function detectExtFromBytes(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return ".png";
  return null;
}

/**
 * Pads the integer portion of a numeric token to `width` digits.
 * Special tokens like "none" pass through unchanged.
 *
 * Contract: `value` must be a non-empty string of digits, optionally followed by
 * `.<digits>`, OR the literal "none". Other shapes (empty string, leading dot,
 * negative sign) are not supported and may produce undefined output.
 * The range parser guarantees this contract for all legitimate callers.
 *
 * Examples:
 *   ("1", 3)    → "001"
 *   ("103", 3)  → "103"
 *   ("18.5", 3) → "018.5"
 *   ("1.25", 3) → "001.25"
 *   ("none", 3) → "none"
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
