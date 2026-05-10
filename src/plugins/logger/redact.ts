const DENYLIST = new Set(["cookies", "cf_clearance", "useragent", "authorization"]);
const REDACTED = "[REDACTED]";

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = DENYLIST.has(k.toLowerCase()) ? REDACTED : redact(v);
    }
    return out;
  }
  return value;
}
