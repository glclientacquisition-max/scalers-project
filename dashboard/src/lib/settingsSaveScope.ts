/**
 * Which form fields a Settings panel is allowed to overwrite.
 * Other fields stay on the stored tenant so a Hours save cannot wipe the catalog.
 * An unknown scope keeps the submitted form (older clients).
 */
const SETTINGS_SCOPE_FIELDS: Record<string, readonly string[]> = {
  identity: [
    "businessName",
    "agentName",
    "agentTone",
    "vertical",
    "socialHandles",
    "businessLocations",
    "businessPolicies",
  ],
  catalog: ["servicesNotes", "servicesCatalog", "productCatalog"],
  hours: ["hoursSchedule", "locationNotes", "afterHoursMode"],
  locations: ["businessLocations"],
  policies: ["businessPolicies", "unknownAnswerFallback"],
  tools: ["agentTools", "sonioxVoiceId", "sonioxVoiceLabel"],
  pronunciation: ["ttsLexicon"],
  team: ["teamDirectory", "handoffMode"],
  faqs: ["faqs"],
};

export function settingsFieldFromScope<T>(
  scope: string,
  field: string,
  fromForm: T,
  stored: T
): T {
  const owned = SETTINGS_SCOPE_FIELDS[scope];
  if (!owned) return fromForm;
  return owned.includes(field) ? fromForm : stored;
}
