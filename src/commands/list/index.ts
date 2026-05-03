import { createInterface } from "node:readline";
import {
  formatCandidateList,
  formatChapterDetail,
  formatMangaList,
  formatVolumeList,
} from "./formatter.ts";
import type { ChapterRef, ListArgs, ListContext, MangaDexClientLike } from "./types.ts";

export type { ListArgs, ListContext } from "./types.ts";

/** Prompt the user to pick one candidate interactively. Resolves to the index chosen (0-based). */
function promptPick(candidates: { title: string }[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const list = candidates.map((c, i) => `  [${i + 1}] ${c.title}`).join("\n");
    process.stderr.write(`Multiple results found:\n${list}\nPick one: `);
    rl.once("line", (line) => {
      rl.close();
      const n = Number.parseInt(line.trim(), 10);
      if (Number.isNaN(n) || n < 1 || n > candidates.length) {
        reject(new Error(`Invalid selection: "${line.trim()}"`));
      } else {
        resolve(n - 1);
      }
    });
  });
}

export async function runList(
  args: ListArgs,
  ctx: ListContext,
  client: MangaDexClientLike,
): Promise<void> {
  const { manga, volume, chapter, nonTty } = args;
  const { logger, languages } = ctx;

  // --volume and --chapter are mutually exclusive
  if (volume !== undefined && chapter !== undefined) {
    throw new Error("--volume and --chapter are mutually exclusive");
  }

  logger.info({ event: "list.search_start", context: "list", title: manga }, "searching manga");

  const candidates = await client.resolveTitleToId(manga);

  // Candidate resolution
  let chosenIndex = 0;
  if (candidates.length > 1) {
    if (nonTty) {
      // Non-interactive: fail with readable list
      const list = formatCandidateList(candidates);
      throw new Error(
        `Multiple results found for "${manga}". Re-run in a terminal to pick one:\n${list}`,
      );
    }
    chosenIndex = await promptPick(candidates);
  }

  const chosen = candidates[chosenIndex];
  if (!chosen) throw new Error("No candidate selected");

  logger.info(
    { event: "list.manga_resolved", context: "list", id: chosen.id, title: chosen.title },
    "manga resolved",
  );

  // --- single chapter detail ---
  if (chapter !== undefined) {
    const chapters = await client.feedChapters(chosen.id, languages);
    const match = chapters.find((c) => c.chapter === chapter);
    if (!match) {
      throw new Error(
        `Chapter ${chapter} not found for "${chosen.title}" in languages: ${languages.join(", ")}`,
      );
    }
    process.stdout.write(`${formatChapterDetail(chosen, match)}\n`);
    return;
  }

  // --- volume or full listing ---
  const volumes = await client.aggregateVolumes(chosen.id, languages);

  if (volume !== undefined) {
    // Find the requested volume
    const volRef = volumes.find((v) => v.volume === volume);
    if (!volRef) {
      throw new Error(
        `Volume ${volume} not found for "${chosen.title}" in languages: ${languages.join(", ")}`,
      );
    }

    // Fetch full chapter feed to get titles
    const allChapters = await client.feedChapters(chosen.id, languages);
    const chapterById = new Map<string, ChapterRef>(allChapters.map((c) => [c.id, c]));

    const volChapters: ChapterRef[] = volRef.chapterIds
      .map((id) => chapterById.get(id))
      .filter((c): c is ChapterRef => c !== undefined);

    process.stdout.write(`${formatVolumeList(chosen, volume, volChapters)}\n`);
    return;
  }

  // Full listing
  const allChapters = await client.feedChapters(chosen.id, languages);
  process.stdout.write(`${formatMangaList(chosen, volumes, allChapters)}\n`);
}
