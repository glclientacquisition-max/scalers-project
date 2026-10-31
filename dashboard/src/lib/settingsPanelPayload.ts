import type { TenantRow } from "@/lib/supabase";
import { withKbCatalogue, type KbCatalogueView } from "@/lib/kbRead";

/**
 * Fields the active Settings view reads. The prompt and the catalogs stay off
 * every other panel. Save merges the stored tenant for fields this view omits.
 *
 * Contract: BusinessSettingsShell remounts TenantForm when `formPanel` (and
 * stripped-field fingerprints) change, because TenantForm hydrates policies /
 * locations / lexicon / catalogs only in useState initializers.
 */
const KEEP: Record<string, readonly (keyof TenantRow)[]> = {
  menu: ["social_handles", "business_locations", "business_policies"],
  // Identity › How you answer: Hear it reads the stored lexicon. Save scope omits ttsLexicon.
  identity: ["social_handles", "business_locations", "business_policies", "tts_lexicon"],
  catalog: ["services_catalog", "product_catalog", "services_offered"],
  hours: [],
  locations: ["business_locations", "service_areas", "business_policies"],
  policies: ["business_policies", "tts_lexicon"],
  tools: [],
  pronunciation: ["tts_lexicon", "daily_bulletin"],
  team: ["team_directory"],
  faqs: ["faqs"],
  test: [
    "services_catalog",
    "services_offered",
    "product_catalog",
    "team_directory",
    "tts_lexicon",
  ],
  import: [],
  alerts: [],
};

export function settingsViewKey(tab: string, panel: string): string {
  if (tab === "train") return panel;
  if (tab === "catalog") return "catalog";
  return tab;
}

/** True when this view shows catalogue fields (load the KB view for it). */
export function settingsViewReadsCatalogue(tab: string, panel: string): boolean {
  return (KEEP[settingsViewKey(tab, panel)] || []).some((k) => k === "services_offered" || k === "services_catalog" || k === "product_catalog");
}

/**
 * `kb`: the catalogue read from kb_items (loadKbCatalogueView). When present it replaces the stored
 * services_catalog / product_catalog / services_offered; null (no KB tables, prod today) keeps the stored columns.
 */
export function tenantForSettingsView(
  stored: TenantRow,
  tab: string,
  panel: string,
  kb: KbCatalogueView | null = null
): TenantRow {
  const tenant = withKbCatalogue(stored, kb) as TenantRow;
  const keep = new Set(KEEP[settingsViewKey(tab, panel)] || []);
  return {
    ...tenant,
    llm_system_prompt: null,
    services_offered: keep.has("services_offered") ? tenant.services_offered : "",
    services_catalog: keep.has("services_catalog") ? tenant.services_catalog : [],
    product_catalog: keep.has("product_catalog") ? tenant.product_catalog : [],
    social_handles: keep.has("social_handles") ? tenant.social_handles : { channels: [] },
    faqs: keep.has("faqs") ? tenant.faqs : [],
    team_directory: keep.has("team_directory") ? tenant.team_directory : [],
    tts_lexicon: keep.has("tts_lexicon") ? tenant.tts_lexicon : [],
    daily_bulletin: keep.has("daily_bulletin") ? tenant.daily_bulletin : [],
    business_locations: keep.has("business_locations") ? tenant.business_locations : [],
    business_policies: keep.has("business_policies") ? tenant.business_policies : {},
  };
}
