const JITTER_MAX_MS = 200;

export function jitter(): number {
  return Math.floor(Math.random() * JITTER_MAX_MS);
}
