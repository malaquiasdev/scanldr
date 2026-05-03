// Pure formatting functions — no I/O, no side effects.

import type { ChapterRef, MangaCandidate, VolumeRef } from "./types.ts";

/**
 * Parses the hostname from a URL and returns the first label (e.g. "mangaplus").
 * Returns `null` when the URL is malformed so callers can distinguish "bad URL"
 * from "valid URL with no useful label" (empty host), instead of silently swallowing
 * the parse error.
 */
export function parseExternalHost(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] ?? host;
  } catch {
    return null;
  }
}

/**
 * Returns a short human-readable label for an external chapter URL.
 * e.g. "https://mangaplus.shueisha.co.jp/..." → "mangaplus"
 *      "https://comikey.com/..." → "comikey"
 * Returns empty string when the URL cannot be parsed (malformed / no scheme).
 * @deprecated prefer parseExternalHost which returns null for malformed URLs.
 */
export function formatExternalTag(url: string): string {
  return parseExternalHost(url) ?? "";
}

/** Format full manga listing (all volumes). */
export function formatMangaList(
  candidate: MangaCandidate,
  volumes: VolumeRef[],
  chapters: ChapterRef[],
): string {
  const lines: string[] = [];

  lines.push(`${candidate.title} (id: ${candidate.id})`);

  // Collect unique languages
  const langs = [...new Set(chapters.map((c) => c.translatedLanguage))].sort();
  lines.push(`Languages available: ${langs.join(", ")}`);
  lines.push("");

  // Build a map of chapterId → ChapterRef for quick lookup
  const chapterById = new Map<string, ChapterRef>(chapters.map((c) => [c.id, c]));

  for (const vol of volumes) {
    const label = vol.volume === "none" ? "none" : `Volume ${vol.volume}`;
    lines.push(label);

    // Collect unique chapters by chapter number from chapterIds
    const seen = new Set<string>();
    const volChapters: ChapterRef[] = [];
    for (const id of vol.chapterIds) {
      const ch = chapterById.get(id);
      if (!ch) continue;
      const key = `${ch.chapter ?? "?"}:${ch.translatedLanguage}`;
      if (!seen.has(key)) {
        seen.add(key);
        volChapters.push(ch);
      }
    }

    // Sort by chapter number
    volChapters.sort((a, b) => {
      const an = Number(a.chapter ?? "NaN");
      const bn = Number(b.chapter ?? "NaN");
      if (Number.isNaN(an) && Number.isNaN(bn)) return 0;
      if (Number.isNaN(an)) return 1;
      if (Number.isNaN(bn)) return -1;
      return an - bn;
    });

    for (const ch of volChapters) {
      const num = ch.chapter ?? "?";
      const title = ch.title ? ` — ${ch.title}` : "";
      const extTag = ch.externalUrl !== null ? formatExternalTag(ch.externalUrl) : null;
      const ext = extTag === null ? "" : extTag ? ` [external: ${extTag}]` : " [external]";
      lines.push(`  Chapter ${num}${title}${ext}`);
    }

    lines.push("");
  }

  // Collect all unique scanlation groups
  const groups = [
    ...new Set(chapters.map((c) => c.scanlationGroup).filter((g): g is string => g !== null)),
  ].sort();

  if (groups.length > 0) {
    lines.push(`Groups: ${groups.map((g) => `[${g}]`).join(" ")}`);
  }

  return lines.join("\n");
}

/** Format chapters for a single volume. */
export function formatVolumeList(
  candidate: MangaCandidate,
  volumeLabel: string,
  chapters: ChapterRef[],
): string {
  const lines: string[] = [];

  lines.push(`${candidate.title} — Volume ${volumeLabel}`);

  const sorted = [...chapters].sort((a, b) => {
    const an = Number(a.chapter ?? "NaN");
    const bn = Number(b.chapter ?? "NaN");
    if (Number.isNaN(an) && Number.isNaN(bn)) return 0;
    if (Number.isNaN(an)) return 1;
    if (Number.isNaN(bn)) return -1;
    return an - bn;
  });

  for (const ch of sorted) {
    const num = ch.chapter ?? "?";
    const title = ch.title ? ` — ${ch.title}` : "";
    const extTag = ch.externalUrl !== null ? formatExternalTag(ch.externalUrl) : null;
    const ext = extTag === null ? "" : extTag ? ` [external: ${extTag}]` : " [external]";
    lines.push(`  Chapter ${num}${title}${ext}`);
  }

  return lines.join("\n");
}

/** Format details of a single chapter. */
export function formatChapterDetail(
  candidate: MangaCandidate,
  chapter: ChapterRef,
  pages?: number,
): string {
  const lines: string[] = [];
  const chNum = chapter.chapter ?? "?";
  const titleSuffix = chapter.title ? `: ${chapter.title}` : "";
  lines.push(`${candidate.title} — Chapter ${chNum}${titleSuffix}`);
  lines.push(`Volume:    ${chapter.volume ?? "none"}`);
  if (pages !== undefined) {
    lines.push(`Pages:     ${pages}`);
  }
  lines.push(`Language:  ${chapter.translatedLanguage}`);
  lines.push(`Group:     ${chapter.scanlationGroup ?? "—"}`);
  if (chapter.externalUrl !== null) {
    lines.push(`External:  ${chapter.externalUrl}`);
  }
  lines.push(`Published: ${chapter.readableAt.slice(0, 10)}`);
  return lines.join("\n");
}

/** Format a list of candidates for interactive / non-tty selection. */
export function formatCandidateList(candidates: MangaCandidate[]): string {
  return candidates
    .map((c, i) => `  [${i + 1}] ${c.title}${c.year ? ` (${c.year})` : ""} — id: ${c.id}`)
    .join("\n");
}
