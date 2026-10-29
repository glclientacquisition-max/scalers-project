/**
 * Canonical business type for Desk and Voice (three values only).
 * Reads tenants.business_type first, then maps tenants.vertical (hospitality → general).
 * Keep src/conversation/businessType.js in sync.
 */
import taxonomy from "./taxonomy.json" with { type: "json" };

export type BusinessType = "retail" | "home_services" | "general";

export type BusinessTypeInput = {
  business_type?: unknown;
  vertical?: unknown;
};

const BUSINESS_TYPE_SET = new Set<string>(["retail", "home_services", "general"]);

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  retail: "Shop",
  home_services: "Home services",
  general: "Other business",
};

export const BUSINESS_TYPE_OPTIONS: { id: BusinessType; label: string; blurb: string }[] = (
  taxonomy as { business_types: { id: string; label: string }[] }
).business_types
  .filter((row): row is { id: BusinessType; label: string } => BUSINESS_TYPE_SET.has(row.id))
  .map((row) => ({
    id: row.id,
    label: row.label,
    blurb:
      row.id === "retail"
        ? "Holds, stock, pickup."
        : row.id === "home_services"
          ? "We come to you."
          : "Hours, FAQ, message.",
  }));

/** Parse a stored business_type value. Returns null when empty or unknown. */
export function parseBusinessType(raw: unknown): BusinessType | null {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (v === "retail" || v === "shop" || v === "shops") return "retail";
  if (v === "home_services" || v === "homeservices" || v === "home_service") return "home_services";
  if (v === "general" || v === "other") return "general";
  return null;
}

/** Map legacy vertical column to business type. */
export function verticalToBusinessType(vertical: unknown): BusinessType {
  const v = String(vertical ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (v === "retail" || v === "shop" || v === "shops") return "retail";
  if (v === "home_services" || v === "homeservices" || v === "home_service") {
    return "home_services";
  }
  return "general";
}

/** Single resolver for all readers. */
export function resolveBusinessType(input: BusinessTypeInput): BusinessType {
  const direct = parseBusinessType(input.business_type);
  if (direct) return direct;
  return verticalToBusinessType(input.vertical);
}

/** Write both columns: business_type is canonical; vertical stays aligned for back-compat. */
export function verticalForBusinessType(type: BusinessType): "retail" | "home_services" | "general" {
  return type;
}

export function businessTypeLabel(type: BusinessType): string {
  return BUSINESS_TYPE_LABELS[type] ?? BUSINESS_TYPE_LABELS.general;
}

export function isRetailBusinessType(type: BusinessType): boolean {
  return type === "retail";
}

export function isHomeVisitBusinessType(type: BusinessType): boolean {
  return type === "home_services";
}

/** Booking / service question flow (not shop holds). Includes Other business. */
export function usesServicesCallFlow(type: BusinessType): boolean {
  return type === "home_services" || type === "general";
}

export function resolveTenantBusinessType(tenant: BusinessTypeInput): BusinessType {
  return resolveBusinessType(tenant);
}
