// Pure parse functions — convert raw MangaDex API shapes into internal types.
// Nothing in this file imports from the HTTP layer; no API types leak outward.

import type {
  ChapterRef,
  MangaCandidate,
  MdxAggregateResponse,
  MdxChapterListResponse,
  MdxMangaListResponse,
  VolumeRef,
} from "./types.ts";

// BCP 47 normalisation: MangaDex returns all-lowercase ("pt-br", "zh-hk").
// We uppercase the region subtag so callers get canonical form ("pt-BR", "zh-HK").
export function normalizeLang(raw: string): string {
  const parts = raw.split("-");
  if (parts.length === 1) return raw;
  const [lang, ...rest] = parts;
  const normalized = rest.map((r) => (r.length === 2 ? r.toUpperCase() : r));
  return [lang, ...normalized].join("-");
}

function pickTitle(titles: Record<string, string>): string {
  return titles.en ?? titles["ja-ro"] ?? titles.ja ?? Object.values(titles)[0] ?? "";
}

export function parseMangaList(raw: MdxMangaListResponse): MangaCandidate[] {
  return raw.data.map((item) => ({
    id: item.id,
    title: pickTitle(item.attributes.title),
    originalLanguage: normalizeLang(item.attributes.originalLanguage),
    year: item.attributes.year,
  }));
}

function parseVolumeNumeric(volume: string): number {
  if (volume === "none") return Number.NaN;
  const n = Number(volume);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function parseAggregate(raw: MdxAggregateResponse): VolumeRef[] {
  const entries = Object.entries(raw.volumes);

  const refs: VolumeRef[] = entries.map(([key, vol]) => {
    const chapterIds = Object.values(vol.chapters).flatMap((ch) => [ch.id, ...ch.others]);
    return {
      volume: key,
      numeric: parseVolumeNumeric(key),
      chapterIds,
    };
  });

  // Sort: numbered volumes first (ascending), then "none"
  refs.sort((a, b) => {
    const aNaN = Number.isNaN(a.numeric);
    const bNaN = Number.isNaN(b.numeric);
    if (aNaN && bNaN) return 0;
    if (aNaN) return 1;
    if (bNaN) return -1;
    return a.numeric - b.numeric;
  });

  return refs;
}

export function parseChapterFeed(raw: MdxChapterListResponse): ChapterRef[] {
  return raw.data.map((item) => {
    const groupRel = item.relationships.find((r) => r.type === "scanlation_group");
    const scanlationGroup = groupRel?.attributes?.name ?? null;

    return {
      id: item.id,
      volume: item.attributes.volume,
      chapter: item.attributes.chapter,
      title: item.attributes.title,
      translatedLanguage: normalizeLang(item.attributes.translatedLanguage),
      scanlationGroup: typeof scanlationGroup === "string" ? scanlationGroup : null,
      readableAt: item.attributes.readableAt,
    };
  });
}
