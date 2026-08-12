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
    blurb: "Products and stock",
  },
  {
    id: "home_services",
    label: "Home services",
    blurb: "Repairs and visits",
  },
  {
    id: "hospitality",
    label: "Hotel / lodge / restaurant",
    blurb: "Stays and tables",
  },
  {
    id: "general",
    label: "Other / general",
    blurb: "General receptionist",
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
