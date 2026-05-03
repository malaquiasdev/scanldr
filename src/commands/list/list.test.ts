import { describe, expect, it } from "bun:test";
import {
  formatCandidateList,
  formatChapterDetail,
  formatExternalTag,
  formatMangaList,
  formatVolumeList,
} from "./formatter.ts";
import { runList } from "./index.ts";
import type {
  ChapterRef,
  ListContext,
  MangaCandidate,
  MangaDexClientLike,
  VolumeRef,
} from "./types.ts";

// --- Fixtures ---

const candidate: MangaCandidate = {
  id: "a1c7c817-4e59-43b7-9365-09675a149a6f",
  title: "One Piece",
  originalLanguage: "ja",
  year: 1997,
};

const volumes: VolumeRef[] = [
  { volume: "1", numeric: 1, chapterIds: ["ch-001", "ch-002", "ch-003"] },
  { volume: "2", numeric: 2, chapterIds: ["ch-009", "ch-010"] },
];

const chapters: ChapterRef[] = [
  {
    id: "ch-001",
    volume: "1",
    chapter: "1",
    title: "Romance Dawn",
    translatedLanguage: "en",
    scanlationGroup: "TCB Scans",
    readableAt: "1997-07-22T00:00:00+00:00",
    externalUrl: null,
  },
  {
    id: "ch-002",
    volume: "1",
    chapter: "2",
    title: "They Call Him",
    translatedLanguage: "en",
    scanlationGroup: "TCB Scans",
    readableAt: "1997-07-29T00:00:00+00:00",
    externalUrl: null,
  },
  {
    id: "ch-003",
    volume: "1",
    chapter: "3",
    title: "Morgan versus Luffy",
    translatedLanguage: "en",
    scanlationGroup: "TCB Scans",
    readableAt: "1997-08-05T00:00:00+00:00",
    externalUrl: "https://mangaplus.shueisha.co.jp/viewer/1000001",
  },
  {
    id: "ch-009",
    volume: "2",
    chapter: "9",
    title: "Versus Cabaji!!",
    translatedLanguage: "en",
    scanlationGroup: "Manga Plus",
    readableAt: "1997-10-14T00:00:00+00:00",
    externalUrl: null,
  },
  {
    id: "ch-010",
    volume: "2",
    chapter: "10",
    title: "Incident at the Bar",
    translatedLanguage: "en",
    scanlationGroup: "Manga Plus",
    readableAt: "1997-10-21T00:00:00+00:00",
    externalUrl: "https://comikey.com/read/example/1",
  },
];

const ctx: ListContext = {
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  languages: ["en"],
};

// --- formatter tests ---

describe("formatMangaList", () => {
  it("includes manga title and id", () => {
    const output = formatMangaList(candidate, volumes, chapters);
    expect(output).toContain("One Piece (id: a1c7c817-4e59-43b7-9365-09675a149a6f)");
  });

  it("includes languages available", () => {
    const output = formatMangaList(candidate, volumes, chapters);
    expect(output).toContain("Languages available: en");
  });

  it("includes volume headers", () => {
    const output = formatMangaList(candidate, volumes, chapters);
    expect(output).toContain("Volume 1");
    expect(output).toContain("Volume 2");
  });

  it("includes chapter lines with titles", () => {
    const output = formatMangaList(candidate, volumes, chapters);
    expect(output).toContain("Chapter 1 — Romance Dawn");
    expect(output).toContain("Chapter 9 — Versus Cabaji!!");
  });

  it("includes groups section", () => {
    const output = formatMangaList(candidate, volumes, chapters);
    expect(output).toContain("Groups: [Manga Plus] [TCB Scans]");
  });
});

describe("formatVolumeList", () => {
  it("shows volume header", () => {
    const out = formatVolumeList(candidate, "1", chapters.slice(0, 3));
    expect(out).toContain("One Piece — Volume 1");
  });

  it("lists chapters in order", () => {
    const out = formatVolumeList(candidate, "1", chapters.slice(0, 3));
    expect(out).toContain("Chapter 1 — Romance Dawn");
    expect(out).toContain("Chapter 3 — Morgan versus Luffy");
  });
});

// chapter 0 is always defined — it's a module-level constant array literal above
const ch0 = chapters[0] ?? {
  id: "",
  volume: null,
  chapter: null,
  title: null,
  translatedLanguage: "en",
  scanlationGroup: null,
  readableAt: "",
  externalUrl: null,
};

describe("formatChapterDetail", () => {
  it("shows chapter header with title", () => {
    const out = formatChapterDetail(candidate, ch0);
    expect(out).toContain("One Piece — Chapter 1: Romance Dawn");
  });

  it("shows volume, language, group, published", () => {
    const out = formatChapterDetail(candidate, ch0);
    expect(out).toContain("Volume:    1");
    expect(out).toContain("Language:  en");
    expect(out).toContain("Group:     TCB Scans");
    expect(out).toContain("Published: 1997-07-22");
  });

  it("shows pages when provided", () => {
    const out = formatChapterDetail(candidate, ch0, 53);
    expect(out).toContain("Pages:     53");
  });
});

describe("formatCandidateList", () => {
  it("numbers candidates starting at 1", () => {
    const out = formatCandidateList([candidate]);
    expect(out).toContain("[1] One Piece");
  });
});

// --- runList tests ---

function makeClient(overrides: Partial<MangaDexClientLike> = {}): MangaDexClientLike {
  return {
    resolveTitleToId: async (_title) => [candidate],
    aggregateVolumes: async (_id, _langs) => volumes,
    feedChapters: async (_id, _langs, _offset) => chapters,
    ...overrides,
  };
}

describe("runList", () => {
  it("throws CliError when --volume and --chapter are both set", async () => {
    const client = makeClient();
    await expect(
      runList({ manga: "One Piece", volume: "1", chapter: "1", nonTty: true }, ctx, client),
    ).rejects.toThrow("--volume and --chapter are mutually exclusive");
  });

  it("non-tty: throws with candidate list when multiple results", async () => {
    const client = makeClient({
      resolveTitleToId: async () => [
        candidate,
        { id: "other-id", title: "One Piece: Romance Dawn", originalLanguage: "ja", year: 2000 },
      ],
    });
    await expect(runList({ manga: "One Piece", nonTty: true }, ctx, client)).rejects.toThrow(
      "Multiple results found",
    );
  });

  it("single result: writes full listing to stdout", async () => {
    const written: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // biome-ignore lint/suspicious/noExplicitAny: test interception
    process.stdout.write = (chunk: any) => {
      written.push(chunk);
      return true;
    };
    try {
      await runList({ manga: "One Piece", nonTty: true }, ctx, makeClient());
    } finally {
      process.stdout.write = origWrite;
    }
    const output = written.join("");
    expect(output).toContain("One Piece (id:");
    expect(output).toContain("Volume 1");
    expect(output).toContain("Chapter 1 — Romance Dawn");
  });

  it("--volume: writes volume listing", async () => {
    const written: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // biome-ignore lint/suspicious/noExplicitAny: test interception
    process.stdout.write = (chunk: any) => {
      written.push(chunk);
      return true;
    };
    try {
      await runList({ manga: "One Piece", volume: "1", nonTty: true }, ctx, makeClient());
    } finally {
      process.stdout.write = origWrite;
    }
    const output = written.join("");
    expect(output).toContain("One Piece — Volume 1");
  });

  it("--volume: throws when volume not found", async () => {
    await expect(
      runList({ manga: "One Piece", volume: "99", nonTty: true }, ctx, makeClient()),
    ).rejects.toThrow("Volume 99 not found");
  });

  it("--chapter: writes chapter detail", async () => {
    const written: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // biome-ignore lint/suspicious/noExplicitAny: test interception
    process.stdout.write = (chunk: any) => {
      written.push(chunk);
      return true;
    };
    try {
      await runList({ manga: "One Piece", chapter: "1", nonTty: true }, ctx, makeClient());
    } finally {
      process.stdout.write = origWrite;
    }
    const output = written.join("");
    expect(output).toContain("One Piece — Chapter 1: Romance Dawn");
    expect(output).toContain("Published: 1997-07-22");
  });

  it("--chapter: throws when chapter not found", async () => {
    await expect(
      runList({ manga: "One Piece", chapter: "999", nonTty: true }, ctx, makeClient()),
    ).rejects.toThrow("Chapter 999 not found");
  });
});

// --- formatExternalTag tests ---

describe("formatExternalTag", () => {
  it("returns 'mangaplus' for mangaplus.shueisha.co.jp", () => {
    expect(formatExternalTag("https://mangaplus.shueisha.co.jp/viewer/1010633")).toBe("mangaplus");
  });

  it("returns 'comikey' for comikey.com", () => {
    expect(formatExternalTag("https://comikey.com/read/example/1")).toBe("comikey");
  });

  it("returns first subdomain segment for arbitrary URLs", () => {
    expect(formatExternalTag("https://cubari.moe/read/imgur/xyz")).toBe("cubari");
  });

  it("returns empty string for URL without scheme (e.g. 'mangaplus')", () => {
    expect(formatExternalTag("mangaplus")).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(formatExternalTag("")).toBe("");
  });

  it("returns empty string for non-URL string", () => {
    expect(formatExternalTag("not a url at all")).toBe("");
  });
});

// --- external chapter annotation tests ---

describe("formatMangaList — external annotation", () => {
  it("appends [external: mangaplus] for external chapters", () => {
    const out = formatMangaList(candidate, volumes, chapters);
    expect(out).toContain("[external: mangaplus]");
  });

  it("does NOT append external tag for CDN chapters", () => {
    const out = formatMangaList(candidate, volumes, chapters);
    // ch-001 (Romance Dawn) is CDN — must not have external tag
    expect(out).toContain("Chapter 1 — Romance Dawn\n");
  });
});

describe("formatVolumeList — external annotation", () => {
  it("appends [external: mangaplus] for external chapters", () => {
    const vol1Chapters = chapters.filter((c) => c.volume === "1");
    const out = formatVolumeList(candidate, "1", vol1Chapters);
    expect(out).toContain("[external: mangaplus]");
  });

  it("does NOT append tag for CDN chapters", () => {
    const vol1Chapters = chapters.filter((c) => c.volume === "1");
    const out = formatVolumeList(candidate, "1", vol1Chapters);
    expect(out).toContain("Chapter 1 — Romance Dawn\n");
  });
});

describe("formatMangaList — malformed externalUrl", () => {
  it("renders [external] (no host) and does not crash when externalUrl has no scheme", () => {
    const malformedChapter: ChapterRef = {
      id: "ch-bad",
      volume: "1",
      chapter: "5",
      title: null,
      translatedLanguage: "en",
      scanlationGroup: null,
      readableAt: "2020-01-01T00:00:00+00:00",
      externalUrl: "mangaplus",
    };
    const out = formatMangaList(
      candidate,
      [{ volume: "1", numeric: 1, chapterIds: ["ch-bad"] }],
      [malformedChapter],
    );
    expect(out).toContain("[external]");
    expect(out).not.toContain("[external: ]");
  });
});

describe("formatChapterDetail — external annotation", () => {
  it("includes External: line when externalUrl is set", () => {
    const externalChapter = chapters[2]; // ch-003 with mangaplus URL
    if (!externalChapter) throw new Error("fixture missing");
    const out = formatChapterDetail(candidate, externalChapter);
    expect(out).toContain("External:  https://mangaplus.shueisha.co.jp/viewer/1000001");
  });

  it("does NOT include External: line when externalUrl is null", () => {
    const cdnChapter = chapters[0]; // ch-001 with null externalUrl
    if (!cdnChapter) throw new Error("fixture missing");
    const out = formatChapterDetail(candidate, cdnChapter);
    expect(out).not.toContain("External:");
  });
});
