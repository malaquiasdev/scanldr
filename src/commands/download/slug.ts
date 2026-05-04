/** kebab-case a manga title for use as filesystem slug */
export function toSlug(
  title: string,
  logger?: { warn: (fields: Record<string, unknown>, msg: string) => void },
): string {
  const slug = title
    .normalize("NFKD")
    // Strip combining diacritical marks (e.g. accents) after NFKD decomposition
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug === "") {
    logger?.warn(
      { event: "download.slug_empty", context: "download", title },
      "title produced an empty slug; falling back to 'untitled'",
    );
    return "untitled";
  }

  return slug;
}
