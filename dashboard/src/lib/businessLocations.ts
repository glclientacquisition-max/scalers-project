import { coverageAreaLabel, parseCoverageAreas } from "./coverageAreas";

export type BusinessLocation = {
  label: string;
  /** Area from the place directory (county:<id> or place:<id>), or "". */
  area_id?: string;
  address: string;
  landmark: string;
  directions: string;
  coverage_notes: string;
  /** This branch's opening hours, read to callers. */
  hours?: string;
};

export const LOCATIONS_MAX = 8;

export function emptyLocation(): BusinessLocation {
  return {
    label: "",
    address: "",
    landmark: "",
    directions: "",
    coverage_notes: "",
  };
}

export function normalizeBusinessLocations(raw: unknown): BusinessLocation[] {
  if (!raw) return [];
  let rows: unknown[] = [];
  if (Array.isArray(raw)) {
    rows = raw;
  } else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      rows = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const loc: BusinessLocation = {
        label: String(r.label ?? "").trim().slice(0, 80),
        address: String(r.address ?? "").trim().slice(0, 200),
        landmark: String(r.landmark ?? "").trim().slice(0, 200),
        directions: String(r.directions ?? "").trim().slice(0, 400),
        hours: String(r.hours ?? "").trim().slice(0, 80),
        area_id: parseCoverageAreas([String(r.area_id ?? "").trim().toLowerCase()])[0] ?? "",
        coverage_notes: String(
          r.coverage_notes ?? r.coverageNotes ?? ""
        )
          .trim()
          .slice(0, 300),
      };
      if (
        !loc.label &&
        !loc.address &&
        !loc.landmark &&
        !loc.directions &&
        !loc.hours &&
        !loc.area_id &&
        !loc.coverage_notes
      ) {
        return null;
      }
      return loc;
    })
    .filter((x): x is BusinessLocation => Boolean(x))
    .slice(0, LOCATIONS_MAX);
}

export function parseBusinessLocationsField(
  raw: FormDataEntryValue | null
): BusinessLocation[] {
  return normalizeBusinessLocations(String(raw || "").trim() || "[]");
}

/** Build a single location from free-text onboarding / legacy location notes. */
export function locationFromNotes(notes: string, label = "Main"): BusinessLocation[] {
  const text = String(notes || "").trim();
  if (!text) return [];
  return [
    {
      label,
      address: text.slice(0, 200),
      landmark: "",
      directions: "",
      coverage_notes: "",
    },
  ];
}

export function formatLocationsForCompiler(
  locations: BusinessLocation[],
  opts: { noPremises?: boolean } = {}
): string {
  const rows = normalizeBusinessLocations(locations);
  if (opts.noPremises) {
    const out = ["We come to you: there is no shop or office for callers to visit."];
    const base = rows[0];
    if (base) {
      out.push(`Base (for reference only, do not send callers there): ${[base.label, base.address, base.area_id ? coverageAreaLabel(base.area_id) : ""].filter(Boolean).join(", ")}`);
    }
    return out.join("\n");
  }
  if (!rows.length) return "";
  const lines = rows.map((loc, i) => {
    const bits = [`${i + 1}. ${loc.label || "Location"}`];
    if (loc.area_id) bits.push(`Area: ${coverageAreaLabel(loc.area_id)}`);
    if (loc.address) bits.push(`Street: ${loc.address}`);
    if (loc.hours) bits.push(`Hours: ${loc.hours}`);
    if (loc.landmark) bits.push(`Landmark: ${loc.landmark}`);
    if (loc.directions) bits.push(`Find us: ${loc.directions}`);
    if (loc.coverage_notes) bits.push(`Coverage: ${loc.coverage_notes}`);
    return bits.join(" | ");
  });
  if (rows.length > 1) {
    lines.push("Several branches: ask where the caller is, then point them to the nearest branch that serves them, with its hours and Find us line.");
  }
  return lines.join("\n");
}

/** One line under a place in the list: "Nairobi · Opposite Hilton · Own hours". */
export function placeSummary(loc: BusinessLocation): string {
  return [loc.area_id ? coverageAreaLabel(loc.area_id) : loc.address, loc.landmark, loc.hours ? "Own hours" : ""]
    .filter(Boolean)
    .join(" · ");
}

export function validatePlace(loc: BusinessLocation): Record<string, string> {
  if (!loc.label.trim() && !loc.area_id && !loc.address.trim()) return { label: "Add a name or pick the area." };
  return {};
}
