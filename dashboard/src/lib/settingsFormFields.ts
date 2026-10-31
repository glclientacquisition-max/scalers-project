/**
 * Hidden fields a Settings train panel may post.
 * Hours must not send FAQs, places, tools, or alert contacts.
 * Identity, Policies and Catalogue save from their own forms.
 */
const SHARED = ["id", "settings_scope", "owner_field_paths"] as const;

export const PANEL_POST_FIELDS: Record<string, readonly string[]> = {
  catalog: [...SHARED, "services_offered", "services_catalog", "product_catalog", "catalog_baseline", "services_notes"],
  hours: [...SHARED, "hours_schedule", "business_hours"],
  locations: [...SHARED, "business_locations", "location_notes", "no_premises"],
  faqs: [...SHARED, "faqs"],
  tools: [...SHARED, "after_hours_mode", "tool_escalate", "tool_end_call"],
  team: [...SHARED, "team_directory", "handoff_mode"],
  pronunciation: [...SHARED, "tts_lexicon"],
};

const HOURS_FORBIDDEN = [
  "faqs",
  "business_locations",
  "team_directory",
  "tool_escalate",
  "tool_end_call",
  "tts_lexicon",
  "business_policies",
  "handoff_mode",
  "services_catalog",
  "product_catalog",
];

export function panelPostsField(panel: string, name: string): boolean {
  const fields = PANEL_POST_FIELDS[panel];
  if (!fields) return false;
  return fields.includes(name);
}

/** True when a Hours payload cannot overwrite another panel. */
export function hoursPayloadIsScoped(names: readonly string[]): boolean {
  const allowed = new Set(PANEL_POST_FIELDS.hours);
  if (!names.includes("hours_schedule") || !names.includes("settings_scope")) return false;
  return names.every((name) => allowed.has(name)) && HOURS_FORBIDDEN.every((name) => !names.includes(name));
}
