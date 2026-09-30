import type { TenantRow } from "@/lib/supabase";

/**
 * Fields the active Settings view reads. The prompt and the catalogs stay off
 * every other panel. Save merges the stored tenant for fields this view omits.
 */
const KEEP: Record<string, readonly (keyof TenantRow)[]> = {
  menu: ["social_handles", "business_locations", "business_policies"],
  identity: ["social_handles", "business_locations", "business_policies"],
  catalog: ["services_catalog", "product_catalog", "services_offered"],
  hours: [],
  locations: ["business_locations"],
  policies: ["business_policies"],
  tools: [],
  pronunciation: ["tts_lexicon", "daily_bulletin"],
  team: ["team_directory"],
  faqs: ["faqs"],
  test: ["services_catalog", "services_offered", "tts_lexicon"],
  import: [],
  alerts: [],
  appearance: [],
};

export function settingsViewKey(tab: string, panel: string): string {
  if (tab === "train") return panel;
  if (tab === "catalog") return "catalog";
  return tab;
}

export function tenantForSettingsView(
  tenant: TenantRow,
  tab: string,
  panel: string
): TenantRow {
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
