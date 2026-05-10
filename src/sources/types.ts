export type SourceId = "mangakakalot" | "mangadex";

export interface SourceDescriptor {
  id: SourceId;
  label: string;
  requiresAuth: boolean;
}
