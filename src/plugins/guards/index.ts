export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function check(cond: unknown, error: Error): asserts cond {
  if (!cond) throw error;
}
