// Public API for pack primitives used by the walkthrough.
export { fetchCover } from "./cover.ts";
export { buildVolumeFilename, packVolumeReplacingSources } from "./pack.ts";
export type {
  CoverImage,
  PackedChapter,
  PackVolumeInput,
  PackVolumeReplacingSourcesResult,
  PackVolumeResult,
} from "./types.ts";
