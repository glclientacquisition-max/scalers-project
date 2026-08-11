export type BusinessVertical =
  | "general"
  | "retail"
  | "home_services"
  | "hospitality";

export const VERTICAL_OPTIONS: {
  id: BusinessVertical;
  label: string;
  blurb: string;
}[] = [
  {
    id: "retail",
    label: "Retail / shop",
    blurb: "Products, prices, stock questions, holds, and pickup requests.",
  },
  {
    id: "home_services",
    label: "Home services",
    blurb: "Repairs, cleaning, visits — booking and service-area questions.",
  },
  {
    id: "hospitality",
    label: "Hotel / lodge / restaurant",
    blurb: "Stays, tables, amenities, and directions (full booking pack later).",
  },
  {
    id: "general",
    label: "Other / general",
    blurb: "Use the core receptionist until a specialist pack fits better.",
  },
];

export function parseVertical(raw: unknown): BusinessVertical {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (v === "retail") return "retail";
  if (v === "home_services" || v === "homeservices" || v === "home_service") {
    return "home_services";
  }
  if (v === "hospitality" || v === "hotel" || v === "hotels") return "hospitality";
  return "general";
}

export function verticalLabel(vertical: BusinessVertical): string {
  return VERTICAL_OPTIONS.find((o) => o.id === vertical)?.label || "General";
}
