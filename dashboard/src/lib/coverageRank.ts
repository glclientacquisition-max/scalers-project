export type RankedCoverageArea = {
  id: string;
  label: string;
  kind: "county" | "place";
  search: string;
};

function normalizeText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function areaName(area: RankedCoverageArea): string {
  return area.id.slice(area.id.indexOf(":") + 1);
}

function areaWords(area: RankedCoverageArea): string[] {
  return `${areaName(area)} ${area.search}`.split(" ").filter(Boolean);
}

/**
 * Type an estate ("westlands", "nairobi west", "baringo kaba").
 * Every token must prefix a word. Estate-name hits rank above a county-only hit
 * so Nairobi does not hide Westlands and Baringo does not hide Kabarnet.
 * An empty query stays on counties.
 */
export function rankCoverageAreas<T extends RankedCoverageArea>(
  directory: readonly T[],
  query: string,
  selected: readonly string[],
  limit = 20
): T[] {
  const chosen = new Set(selected);
  const q = normalizeText(query);
  const pool = directory.filter((area) => !chosen.has(area.id));
  if (!q) return pool.filter((area) => area.kind === "county");
  const tokens = q.split(" ").filter(Boolean);
  const ranked: { area: T; score: number }[] = [];
  for (const area of pool) {
    const words = areaWords(area);
    if (!tokens.every((token) => words.some((word) => word.startsWith(token)))) continue;
    const name = areaName(area);
    const nameWords = name.split(" ").filter(Boolean);
    const nameHits = tokens.filter((token) =>
      nameWords.some((word) => word.startsWith(token))
    ).length;
    const exact = name === q ? 5 : 0;
    const starts = name.startsWith(q) ? 1 : 0;
    const placeBoost = area.kind === "place" && nameHits > 0 ? 1 : 0;
    ranked.push({
      area,
      score: nameHits * 10 + exact + starts + placeBoost,
    });
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.area.kind !== b.area.kind) return a.area.kind === "place" ? -1 : 1;
    return a.area.label.localeCompare(b.area.label);
  });
  return ranked.slice(0, limit).map((row) => row.area);
}
