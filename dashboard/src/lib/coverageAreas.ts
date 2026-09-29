import INDEX from "@/lib/data/kenyaPlaceCounties.json";

export const COVERAGE_AREA_MAX = 40;

const COUNTY_SET = new Set(INDEX.counties);

export type CoverageAreaKind = "county" | "place";

export type CoverageAreaOption = {
  id: string;
  label: string;
  kind: CoverageAreaKind;
  search: string;
};

function titleName(name: string): string {
  if (name === "muranga") return "Murang'a";
  return name.replace(/\b[a-z]+/g, (word) =>
    word === "cbd" ? "CBD" : word.charAt(0).toUpperCase() + word.slice(1)
  );
}

function normalizeText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DIRECTORY: CoverageAreaOption[] = (() => {
  const counties = INDEX.counties
    .map((county) => ({
      id: `county:${county}`,
      label: titleName(county),
      kind: "county" as const,
      search: county,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const places = Object.entries(INDEX.places)
    .filter(([name]) => !COUNTY_SET.has(name))
    .map(([name, countiesForName]) => {
      const where = countiesForName.map(titleName).join(", ");
      const label = where ? `${titleName(name)}, ${where}` : titleName(name);
      return {
        id: `place:${name}`,
        label,
        kind: "place" as const,
        search: `${name} ${countiesForName.join(" ")}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...counties, ...places];
})();

const BY_ID = new Map(DIRECTORY.map((area) => [area.id, area]));

export function parseCoverageAreas(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const id = String(item || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (!BY_ID.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= COVERAGE_AREA_MAX) break;
  }
  return out;
}

export function coverageAreaLabel(id: string): string {
  return BY_ID.get(id)?.label || titleName(id.slice(id.indexOf(":") + 1));
}

/** Short name for prompts. "Westlands, Nairobi" stays "Westlands". */
export function formatCoverageList(areas: readonly string[]): string {
  return parseCoverageAreas(areas)
    .map((id) => coverageAreaLabel(id).split(",")[0].trim())
    .join(", ");
}

export { areasFromPlainText } from "./coverageSeed";

export function searchCoverageAreas(
  query: string,
  selected: readonly string[],
  limit = 20
): CoverageAreaOption[] {
  const chosen = new Set(selected);
  const q = normalizeText(query);
  const pool = DIRECTORY.filter((area) => !chosen.has(area.id));
  if (!q) return pool.filter((area) => area.kind === "county");
  const starts: CoverageAreaOption[] = [];
  const contains: CoverageAreaOption[] = [];
  for (const area of pool) {
    const hay = `${area.search} ${area.label.toLowerCase()}`;
    if (area.search.startsWith(q) || area.label.toLowerCase().startsWith(q)) {
      starts.push(area);
    } else if (hay.includes(q)) {
      contains.push(area);
    }
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
