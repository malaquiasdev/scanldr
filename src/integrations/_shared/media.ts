export interface ImageRef {
  url: string;
  page: number;
}

export interface ChapterInput {
  id: string;
  num: number;
  pages: ImageRef[];
  imageFetcher: (ref: ImageRef) => Promise<Uint8Array>;
}
