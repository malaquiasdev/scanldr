export function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function extFromContentType(contentType: string | null | undefined): string {
  if (!contentType) return ".jpg";
  const ct = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (ct === "image/png") return ".png";
  if (ct === "image/jpeg" || ct === "image/jpg") return ".jpg";
  if (ct === "image/webp") return ".webp";
  if (ct === "image/gif") return ".gif";
  if (ct === "image/avif") return ".avif";
  return ".jpg";
}

export function detectExtFromBytes(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return ".png";
  return null;
}
