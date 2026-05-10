import type { SourceDescriptor } from "./types.ts";

export type { SourceDescriptor } from "./types.ts";

export const SOURCES: readonly SourceDescriptor[] = [
  { id: "mangakakalot", label: "Mangakakalot", requiresAuth: true },
  { id: "mangadex", label: "MangaDex", requiresAuth: false },
] as const;

export function getSource(id: string): SourceDescriptor {
  const found = SOURCES.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown source: "${id}"`);
  return found;
}
