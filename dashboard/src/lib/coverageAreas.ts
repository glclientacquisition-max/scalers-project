import INDEX from "../../../src/conversation/data/kenyaPlaceCounties.json" with { type: "json" };
import { rankCoverageAreas } from "./coverageRank.ts";

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

/**
 * Owner-facing list for any stored coverage value: directory ids become place
 * names, plain text stays as typed. Never shows "county:nairobi" to an owner.
 */
export function coverageDisplayList(raw: unknown): string {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const out: string[] = [];
  for (const entry of list) {
    const text = String(entry || "").trim();
    if (!text) continue;
    const label = /^(county|place):/i.test(text) ? coverageAreaLabel(text.toLowerCase()).split(",")[0].trim() : text;
    if (label && !out.includes(label)) out.push(label);
  }
  return out.join(", ");
}

export { areasFromPlainText } from "./coverageSeed.js";

/** Type an estate. Empty query stays on counties. */
export function searchCoverageAreas(
  query: string,
  selected: readonly string[],
  limit = 20
): CoverageAreaOption[] {
  return rankCoverageAreas(DIRECTORY, query, selected, limit);
}

export type AreaOption = { id: string; label: string; kind: CoverageAreaKind; hint: string; added: boolean };

/** "Corner, Kiambu, Nairobi" (a name in two counties) reads "Corner, Kiambu or Nairobi". */
function pickerLabel(o: CoverageAreaOption): string {
  if (o.kind === "county") return `${o.label} County`;
  const [name, ...counties] = o.label.split(", ");
  return counties.length > 1 ? `${name}, ${counties.slice(0, -1).join(", ")} or ${counties[counties.length - 1]}` : o.label;
}

/**
 * Search for pickers: counties read "Kiambu County", estates and towns "Ruaka, Kiambu".
 * Directory rows whose name just repeats a word ("Kiambu Kiambu") are left out.
 */
export function searchAreaOptions(query: string, selected: readonly string[], limit = 8): AreaOption[] {
  // Already-added areas stay in the results, marked Added, instead of vanishing.
  const added = new Set(selected);
  return searchCoverageAreas(query, [], limit * 2)
    .filter((o) => !/\b(\w+) \1\b/i.test(o.label))
    .slice(0, limit)
    .map((o) => ({
      id: o.id,
      kind: o.kind,
      label: pickerLabel(o),
      hint: added.has(o.id) ? "Added" : o.kind === "county" ? "Whole county" : "Estate or town",
      added: added.has(o.id),
    }));
}
