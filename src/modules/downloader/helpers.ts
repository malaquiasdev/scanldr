export function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function detectExtFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return ".png";
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return ".jpg";
  }
  // WebP: RIFF (bytes 0-3) + WEBP (bytes 8-11)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return ".webp";
  }
  // GIF: 47 49 46 38 (GIF8)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return ".gif";
  }
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
