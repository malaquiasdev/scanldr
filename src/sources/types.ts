export type SourceId = "mangakakalot";

export interface SourceDescriptor {
  id: SourceId;
  label: string;
  requiresAuth: boolean;
}
