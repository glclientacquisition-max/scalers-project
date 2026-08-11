export type BusinessLocation = {
  label: string;
  address: string;
  landmark: string;
  directions: string;
  coverage_notes: string;
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

export function formatLocationsForCompiler(locations: BusinessLocation[]): string {
  const rows = normalizeBusinessLocations(locations);
  if (!rows.length) return "";
  return rows
    .map((loc, i) => {
      const bits = [`${i + 1}. ${loc.label || "Location"}`];
      if (loc.address) bits.push(`Address: ${loc.address}`);
      if (loc.landmark) bits.push(`Landmark: ${loc.landmark}`);
      if (loc.directions) bits.push(`Directions: ${loc.directions}`);
      if (loc.coverage_notes) bits.push(`Coverage: ${loc.coverage_notes}`);
      return bits.join(" | ");
    })
    .join("\n");
}
