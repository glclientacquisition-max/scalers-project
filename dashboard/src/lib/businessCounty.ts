/**
 * The business's own county, read from existing location data, as a
 * Service areas tree id (county:<slug>). Null when it can't be told.
 * Pure and browser-safe. Relative imports only so node tests can load it.
 */
import INDEX from "./data/kenyaPlaceCounties.json" with { type: "json" };
import { areaChildren, areaCounties, areaNode, normAreaText } from "./areaPicks.ts";

export type LocationLike = {
  area_id?: string | null;
  label?: string | null;
  address?: string | null;
  landmark?: string | null;
};

const PLACES = INDEX.places as Record<string, string[]>;

function treeCountyId(name: string): string | null {
  const id = `county:${name.trim().toLowerCase().replace(/['’]/g, "").replace(/\s+/g, "-")}`;
  return areaNode(id)?.kind === "county" ? id : null;
}

/** "county:kiambu" or "place:juja" from the place directory. */
function countyFromAreaId(areaId: string): string | null {
  const raw = areaId.trim().toLowerCase();
  if (raw.startsWith("county:")) return treeCountyId(raw.slice("county:".length));
  if (raw.startsWith("place:")) {
    const counties = PLACES[raw.slice("place:".length)] ?? [];
    return counties.length === 1 ? treeCountyId(counties[0]) : null;
  }
  return null;
}

/** Free text like "Westlands, Nairobi" or "Opposite Naivas, Juja". */
export function countyFromText(text: string | null | undefined): string | null {
  const parts = String(text || "")
    .split(/[,\n;/]|\s-\s/)
    .map((p) => normAreaText(p))
    .filter(Boolean);
  if (!parts.length) return null;
  const counties = areaCounties();
  // A county named outright wins over a town or estate name.
  for (const p of parts) {
    const c = counties.find((n) => normAreaText(n.name) === p || normAreaText(n.name) === p.replace(/ county$/, ""));
    if (c) return c.id;
  }
  for (const p of parts) {
    const hit = countyFromTreeName(p);
    if (hit) return hit;
    const placeCounties = PLACES[p];
    if (placeCounties?.length === 1) {
      const c = treeCountyId(placeCounties[0]);
      if (c) return c;
    }
  }
  return null;
}

let NAME_INDEX: Map<string, Set<string>> | null = null;
/** Town, estate or alias name to its county, only when the name is in one county. */
function countyFromTreeName(q: string): string | null {
  if (!NAME_INDEX) {
    const index = new Map<string, Set<string>>();
    for (const c of areaCounties()) {
      const stack = [...areaChildren(c.id)];
      while (stack.length) {
        const n = stack.pop()!;
        for (const name of [n.name, ...n.aliases]) {
          const k = normAreaText(name);
          if (!k) continue;
          const s = index.get(k) ?? new Set<string>();
          s.add(c.id);
          index.set(k, s);
        }
        stack.push(...areaChildren(n.id));
      }
    }
    NAME_INDEX = index;
  }
  const s = NAME_INDEX.get(q);
  return s && s.size === 1 ? [...s][0] : null;
}

/**
 * First location that tells us a county wins: the picked area id, then the
 * address, landmark and label text. Null means show every county.
 */
export function businessHomeCounty(locations: readonly LocationLike[] | null | undefined): string | null {
  for (const loc of locations ?? []) {
    const fromId = loc.area_id ? countyFromAreaId(loc.area_id) : null;
    if (fromId) return fromId;
    for (const text of [loc.address, loc.landmark, loc.label]) {
      const c = countyFromText(text);
      if (c) return c;
    }
  }
  return null;
}

