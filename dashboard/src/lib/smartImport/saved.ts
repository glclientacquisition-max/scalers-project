import { normalizeServicesCatalog, extractServicesNotes } from "../servicesCatalog";
import { normalizeProductCatalog } from "../productCatalog";
import { normalizeBusinessLocations } from "../businessLocations";
import { normalizeBusinessPolicies } from "../businessPolicies";
import { parseHoursSchedule } from "../hoursSchedule";
import { serviceAreasForForm } from "../serviceAreas";
import { parseVertical } from "../vertical";
import type { FaqEntry, TenantRow } from "../supabase";
import { normalizeSocialHandles } from "../socialHandles";
import type { SavedProfile, SavedSettings } from "./diffImport";
import type { PlanContext } from "./plan";

function profileOf(tenant: TenantRow): SavedProfile {
  const channels = normalizeSocialHandles(tenant.social_handles).channels;
  const first = (...kinds: string[]) => channels.find((c) => kinds.includes(c.kind))?.value?.trim() || "";
  return {
    business_name: String(tenant.business_name || "").trim(),
    phone: first("phone", "whatsapp"),
    email: first("email"),
    website: first("website"),
    social: first("instagram", "facebook", "tiktok", "twitter", "youtube"),
  };
}

function faqsOf(raw: unknown): FaqEntry[] {
  return (Array.isArray(raw) ? raw : [])
    .map((r) => ({ question: String((r as FaqEntry)?.question || "").trim(), answer: String((r as FaqEntry)?.answer || "").trim() }))
    .filter((f) => f.question && f.answer);
}

/** What the business has saved, in the shapes the Settings forms post. */
export function savedSettingsFor(tenant: TenantRow): { saved: SavedSettings; ctx: Omit<PlanContext, "sourceLabel"> } {
  const vertical = parseVertical(tenant.vertical);
  const hours = parseHoursSchedule(tenant.hours_schedule);
  return {
    saved: {
      services: normalizeServicesCatalog(tenant.services_catalog).filter((s) => s.name),
      products: normalizeProductCatalog(tenant.product_catalog).filter((p) => p.name),
      faqs: faqsOf(tenant.faqs),
      locations: normalizeBusinessLocations(tenant.business_locations),
      serviceAreas: serviceAreasForForm(
        tenant.service_areas,
        (tenant.business_policies as { coverage_areas?: unknown } | null)?.coverage_areas,
        vertical
      ),
      policies: normalizeBusinessPolicies(tenant.business_policies),
      hours,
      profile: profileOf(tenant),
    },
    ctx: {
      tenantId: tenant.id,
      servicesNotes: extractServicesNotes(tenant.services_offered || ""),
      locationNotes: String(hours?.location || "").trim(),
      vertical,
    },
  };
}

