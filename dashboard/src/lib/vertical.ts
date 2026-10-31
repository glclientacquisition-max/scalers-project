import {
  BUSINESS_TYPE_LABELS,
  BUSINESS_TYPE_OPTIONS,
  resolveBusinessType,
  type BusinessType,
} from "./businessType";

export type BusinessVertical =
  | "general"
  | "retail"
  | "home_services"
  | "hospitality";

/** @deprecated Use BusinessType from businessType.ts */
export type OfferedVertical = BusinessType;

/** @deprecated Onboarding requires an explicit pick; do not default to Shop. */
export const DEFAULT_VERTICAL: BusinessType = "retail";

export const VERTICAL_LABELS: Record<BusinessVertical, string> = {
  retail: BUSINESS_TYPE_LABELS.retail,
  home_services: BUSINESS_TYPE_LABELS.home_services,
  hospitality: "Hotel / lodge / restaurant",
  general: BUSINESS_TYPE_LABELS.general,
};

export const VERTICAL_OPTIONS = BUSINESS_TYPE_OPTIONS;

const VERTICAL_LEGACY_OPTIONS: {
  id: "hospitality";
  label: string;
  blurb: string;
}[] = [
  {
    id: "hospitality",
    label: VERTICAL_LABELS.hospitality,
    blurb: "Hours and messages.",
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
export function offeredVertical(raw: unknown): BusinessType {
  const input =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { business_type?: unknown; vertical?: unknown })
      : { vertical: raw };
  return resolveBusinessType(input);
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
