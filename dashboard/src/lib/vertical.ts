export type BusinessVertical =
  | "general"
  | "retail"
  | "home_services"
  | "hospitality";

/** Packs owners can pick. Stored id for Shop stays `retail`. */
export type OfferedVertical = "retail" | "home_services";

export const DEFAULT_VERTICAL: OfferedVertical = "retail";

export const VERTICAL_LABELS: Record<BusinessVertical, string> = {
  retail: "Shop",
  home_services: "Home services",
  hospitality: "Hotel / lodge / restaurant",
  general: "Other",
};

export const VERTICAL_OPTIONS: {
  id: OfferedVertical;
  label: string;
  blurb: string;
}[] = [
  {
    id: "retail",
    label: VERTICAL_LABELS.retail,
    blurb: "Holds, stock, pickup.",
  },
  {
    id: "home_services",
    label: VERTICAL_LABELS.home_services,
    blurb: "We come to you.",
  },
];

const VERTICAL_LEGACY_OPTIONS: {
  id: Exclude<BusinessVertical, OfferedVertical>;
  label: string;
  blurb: string;
}[] = [
  {
    id: "hospitality",
    label: VERTICAL_LABELS.hospitality,
    blurb: "Hours and messages.",
  },
  {
    id: "general",
    label: VERTICAL_LABELS.general,
    blurb: "Hours, FAQ, message.",
  },
];

export function parseVertical(raw: unknown): BusinessVertical {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (v === "retail" || v === "shop" || v === "shops") return "retail";
  if (v === "home_services" || v === "homeservices" || v === "home_service") {
    return "home_services";
  }
  if (v === "hospitality" || v === "hotel" || v === "hotels") return "hospitality";
  if (v === "general") return "general";
  return "general";
}

/** Playbook and force-save pack. Hospitality runs as general until reservations exist. */
export function offeredVertical(raw: unknown): OfferedVertical | "general" {
  const v = parseVertical(raw);
  if (v === "retail" || v === "home_services") return v;
  return "general";
}

export function isOfferedVertical(raw: unknown): raw is OfferedVertical {
  const v = parseVertical(raw);
  return v === "retail" || v === "home_services";
}

/** Settings shows Shop and Home services. Legacy ids stay visible until the owner picks a pack. */
export function verticalSettingsOptions(current: BusinessVertical): {
  id: BusinessVertical;
  label: string;
  blurb: string;
}[] {
  if (isOfferedVertical(current)) return VERTICAL_OPTIONS;
  const extra = VERTICAL_LEGACY_OPTIONS.find((o) => o.id === current);
  return extra ? [...VERTICAL_OPTIONS, extra] : VERTICAL_OPTIONS;
}

export function verticalLabel(vertical: BusinessVertical): string {
  return VERTICAL_LABELS[vertical] || VERTICAL_LABELS.general;
}

export function verticalBlurb(vertical: BusinessVertical): string {
  const offered = VERTICAL_OPTIONS.find((o) => o.id === vertical);
  if (offered) return offered.blurb;
  return VERTICAL_LEGACY_OPTIONS.find((o) => o.id === vertical)?.blurb || "";
}
