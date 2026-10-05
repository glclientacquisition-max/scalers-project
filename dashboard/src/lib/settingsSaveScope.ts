/**
 * Which form fields a Settings panel is allowed to overwrite.
 * Other fields stay on the stored tenant so a Hours save cannot wipe the catalog.
 * An unknown scope keeps the submitted form (older clients).
 *
 * Identity does not own places or policies. The hours location line is owned by
 * Locations, which is the screen that edits it. Hours owns the weekly grid only.
 * Voice (`tools`) owns after_hours_mode (Message only or Full assistant). It also posts handoff_mode
 * with the rest of the form. Team owns that field, so a Voice save keeps the stored
 * handoff mode, directory, lexicon, catalogs, and FAQs.
 */
const SETTINGS_SCOPE_FIELDS: Record<string, readonly string[]> = {
  identity: [
    "businessName",
    "spokenName",
    "greetingInvite",
    "agentName",
    "agentTone",
    "vertical",
    "socialHandles",
  ],
  catalog: ["servicesNotes", "servicesCatalog", "productCatalog"],
  hours: ["hoursSchedule"],
  locations: ["businessLocations", "locationNotes"],
  policies: ["businessPolicies", "unknownAnswerFallback"],
  tools: ["agentTools", "sonioxVoiceId", "sonioxVoiceLabel", "afterHoursMode"],
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

export type SettingsScopeValidationInput = {
  businessName: string;
  agentName: string;
  servicesCatalogCount: number;
  productCatalogCount: number;
  servicesOfferedLength: number;
  productCatalogMax: number;
  hasSchedule: boolean;
  businessHoursLength: number;
  hasTone: boolean;
  teamCount: number;
  faqCount: number;
  submittedVoiceId: string;
  resolvedVoiceId: string | null;
  voiceLabel: string;
};

function scopeOwns(scope: string, field: string): boolean {
  const owned = SETTINGS_SCOPE_FIELDS[scope];
  if (!owned) return true;
  return owned.includes(field);
}

/** Errors for fields this scope owns. Other panels' fields do not fail the save. */
export function settingsScopeValidationError(
  scope: string,
  input: SettingsScopeValidationInput
): string | null {
  if (scopeOwns(scope, "businessName") && !input.businessName) {
    return "Business name is required.";
  }
  if (scopeOwns(scope, "agentName") && input.agentName.length > 40) {
    return "Assistant name should be under 40 characters.";
  }
  if (
    scopeOwns(scope, "servicesCatalog") &&
    !input.servicesCatalogCount &&
    !input.productCatalogCount &&
    input.servicesOfferedLength < 12
  ) {
    return "Add at least one service or product, or extra service notes.";
  }
  if (scopeOwns(scope, "servicesCatalog") && input.servicesCatalogCount > 40) {
    return "Services are limited to 40 items.";
  }
  if (
    scopeOwns(scope, "productCatalog") &&
    input.productCatalogCount > input.productCatalogMax
  ) {
    return `Product catalogue is limited to ${input.productCatalogMax} items.`;
  }
  if (scopeOwns(scope, "hoursSchedule") && !input.hasSchedule) {
    return "Set at least one open day.";
  }
  if (scopeOwns(scope, "hoursSchedule") && input.businessHoursLength < 8) {
    return "Add business hours and where you operate.";
  }
  if (scopeOwns(scope, "agentTone") && !input.hasTone) {
    return "Pick a tone of voice.";
  }
  if (scopeOwns(scope, "teamDirectory") && input.teamCount > 20) {
    return "Team directory is limited to 20 people.";
  }
  if (scopeOwns(scope, "faqs") && input.faqCount > 25) {
    return "FAQs are limited to 25 pairs.";
  }
  const owned = SETTINGS_SCOPE_FIELDS[scope];
  if (owned?.includes("sonioxVoiceId")) {
    const submitted = String(input.submittedVoiceId || "").trim();
    if (submitted && !input.resolvedVoiceId) {
      return "Pick a voice from the list.";
    }
  }
  if (owned?.includes("sonioxVoiceLabel")) {
    if (String(input.voiceLabel || "").trim().length > 40) {
      return "Voice label should be under 40 characters.";
    }
  }
  return null;
}
