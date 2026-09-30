"use server";

import { revalidatePath } from "next/cache";
import { getAuthUser, isAuthenticated } from "@/lib/auth";
import {
  parseAgentTone,
  compileReceptionistPrompt,
  parseTeamDirectoryField,
  parseFaqsField,
} from "@/lib/promptCompiler";
import {
  formatHoursForCompiler,
  parseHoursSchedule,
} from "@/lib/hoursSchedule";
import { parseAfterHoursMode } from "@/lib/afterHours";
import {
  extractServicesNotes,
  formatServicesForCompiler,
  normalizeServicesCatalog,
  parseServicesCatalogField,
} from "@/lib/servicesCatalog";
import {
  formatProductsForCompiler,
  normalizeProductCatalog,
  parseProductCatalogField,
  PRODUCT_CATALOG_MAX,
} from "@/lib/productCatalog";
import {
  formatSocialHandlesForCompiler,
  parseSocialHandlesField,
} from "@/lib/socialHandles";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { parseAgentTools } from "@/lib/agentTools";
import { parseVertical } from "@/lib/vertical";
import { parseHandoffMode } from "@/lib/handoffMode";
import { parseSonioxVoiceId, parseSonioxVoiceLabel } from "@/lib/sonioxVoiceCatalog";
import {
  formatLocationsForCompiler,
  parseBusinessLocationsField,
} from "@/lib/businessLocations";
import {
  formatPoliciesForCompiler,
  parseBusinessPoliciesField,
} from "@/lib/businessPolicies";
import {
  lexiconForStorage,
  parseTtsLexicon,
} from "@/lib/pronunciationLexicon";
import { ownerSaveFailed } from "@/lib/ownerFacingError";
import { settingsFieldFromScope } from "@/lib/settingsSaveScope";

export type SettingsCompileState = {
  error?: string;
  ok?: boolean;
  source?: "gemini" | "local";
};

export async function saveAndCompileSettings(
  _prev: SettingsCompileState,
  formData: FormData
): Promise<SettingsCompileState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to save settings." };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { error: "No workspace linked to this account." };
  }

  const id = String(formData.get("id") || "").trim();
  if (!id || id !== tenant.id) {
    return { error: "Forbidden." };
  }

  const scope = String(formData.get("settings_scope") || "");
  const pick = <T,>(field: string, fromForm: T, stored: T) =>
    settingsFieldFromScope(scope, field, fromForm, stored);

  const businessName = pick(
    "businessName",
    String(formData.get("business_name") || "").trim(),
    String(tenant.business_name || "").trim()
  );
  const servicesNotes = pick(
    "servicesNotes",
    String(formData.get("services_notes") || "").trim(),
    extractServicesNotes(tenant.services_offered || "")
  );
  const servicesCatalog = pick(
    "servicesCatalog",
    parseServicesCatalogField(formData.get("services_catalog")),
    normalizeServicesCatalog(tenant.services_catalog).filter((row) => row.name)
  );
  const productCatalog = pick(
    "productCatalog",
    parseProductCatalogField(formData.get("product_catalog")),
    normalizeProductCatalog(tenant.product_catalog).filter((row) => row.name)
  );
  const socialHandles = pick(
    "socialHandles",
    parseSocialHandlesField(formData.get("social_handles")),
    parseSocialHandlesField(JSON.stringify(tenant.social_handles || {}))
  );
  const servicesBlock = formatServicesForCompiler(servicesCatalog, servicesNotes);
  const productsBlock = formatProductsForCompiler(productCatalog);
  const socialBlock = formatSocialHandlesForCompiler(socialHandles);
  const compiledServices = [
    servicesBlock,
    productsBlock,
    socialBlock ? `Social & web:\n${socialBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  // A Hours save ships empty catalog fields. Keep the stored offer text when
  // the compiler string is empty so a legacy blob is not replaced by that form.
  const servicesOffered =
    compiledServices ||
    pick(
      "servicesCatalog",
      String(formData.get("services_offered") || "").trim(),
      String(tenant.services_offered || "").trim()
    );
  const agentName = pick(
    "agentName",
    String(formData.get("agent_name") || "").trim() || "Receptionist",
    String(tenant.agent_name || "").trim() || "Receptionist"
  );
  const agentTone = pick(
    "agentTone",
    parseAgentTone(String(formData.get("agent_tone") || "")),
    parseAgentTone(String(tenant.agent_tone || ""))
  );
  const unknownAnswerFallback = pick(
    "unknownAnswerFallback",
    String(formData.get("unknown_answer_fallback") || "").trim(),
    String(tenant.unknown_answer_fallback || "").trim()
  );
  const teamDirectory = pick(
    "teamDirectory",
    parseTeamDirectoryField(formData.get("team_directory")),
    parseTeamDirectoryField(JSON.stringify(tenant.team_directory || []))
  );
  const faqs = pick(
    "faqs",
    parseFaqsField(formData.get("faqs")),
    parseFaqsField(JSON.stringify(tenant.faqs || []))
  );
  const agentTools = pick(
    "agentTools",
    parseAgentTools({
      escalate: String(formData.get("tool_escalate") || "") !== "0",
      end_call: String(formData.get("tool_end_call") || "") !== "0",
    }),
    parseAgentTools(tenant.agent_tools)
  );

  const hoursSchedule = pick(
    "hoursSchedule",
    parseHoursSchedule(formData.get("hours_schedule")),
    parseHoursSchedule(tenant.hours_schedule)
  );
  const locationNotes = pick(
    "locationNotes",
    String(formData.get("location_notes") || "").trim(),
    String(parseHoursSchedule(tenant.hours_schedule)?.location || "").trim()
  );
  const afterHoursMode = pick(
    "afterHoursMode",
    parseAfterHoursMode(formData.get("after_hours_mode")),
    parseAfterHoursMode(tenant.after_hours_mode)
  );
  const vertical = pick(
    "vertical",
    parseVertical(formData.get("vertical")),
    parseVertical(tenant.vertical)
  );
  const handoffMode = pick(
    "handoffMode",
    parseHandoffMode(formData.get("handoff_mode")),
    parseHandoffMode(tenant.handoff_mode)
  );
  const sonioxVoiceId = pick(
    "sonioxVoiceId",
    await parseSonioxVoiceId(formData.get("soniox_voice_id")),
    await parseSonioxVoiceId(tenant.soniox_voice_id)
  );
  const sonioxVoiceLabel = pick(
    "sonioxVoiceLabel",
    parseSonioxVoiceLabel(formData.get("soniox_voice_label")),
    parseSonioxVoiceLabel(tenant.soniox_voice_label)
  );
  const businessLocations = pick(
    "businessLocations",
    parseBusinessLocationsField(formData.get("business_locations")),
    parseBusinessLocationsField(JSON.stringify(tenant.business_locations || []))
  );
  const businessPolicies = pick(
    "businessPolicies",
    parseBusinessPoliciesField(formData.get("business_policies")),
    parseBusinessPoliciesField(JSON.stringify(tenant.business_policies || {}))
  );
  const ttsLexicon = lexiconForStorage(
    pick(
      "ttsLexicon",
      parseTtsLexicon(formData.get("tts_lexicon")),
      parseTtsLexicon(tenant.tts_lexicon)
    )
  );
  const scheduleForSave = hoursSchedule
    ? { ...hoursSchedule, location: locationNotes || hoursSchedule.location }
    : null;
  const compiledHours = formatHoursForCompiler(scheduleForSave);
  const businessHours =
    compiledHours ||
    pick(
      "hoursSchedule",
      String(formData.get("business_hours") || "").trim(),
      String(tenant.business_hours || "").trim()
    );
  const locationsText = formatLocationsForCompiler(businessLocations);
  const policiesText = formatPoliciesForCompiler(businessPolicies);

  if (!businessName) {
    return { error: "Business name is required." };
  }
  if (agentName.length > 40) {
    return { error: "Agent name should be under 40 characters." };
  }
  if (
    !servicesCatalog.length &&
    !productCatalog.length &&
    servicesOffered.length < 12
  ) {
    return {
      error:
        "Add at least one service or product, or extra service notes.",
    };
  }
  if (servicesCatalog.length > 40) {
    return { error: "Services are limited to 40 items." };
  }
  if (productCatalog.length > PRODUCT_CATALOG_MAX) {
    return {
      error: `Product catalogue is limited to ${PRODUCT_CATALOG_MAX} items.`,
    };
  }
  if (!scheduleForSave) {
    return { error: "Set at least one open day in weekly hours." };
  }
  if (businessHours.length < 8) {
    return { error: "Add business hours and where you operate." };
  }
  if (!agentTone) {
    return { error: "Pick a tone of voice." };
  }
  if (teamDirectory.length > 20) {
    return { error: "Team directory is limited to 20 people." };
  }
  if (faqs.length > 25) {
    return { error: "Golden FAQs are limited to 25 pairs." };
  }

  const { prompt, source } = await compileReceptionistPrompt({
    businessName,
    servicesOffered,
    businessHours,
    agentTone,
    agentName,
    teamDirectory,
    faqs,
    unknownAnswerFallback,
    escalateEnabled: agentTools.escalate,
    vertical,
    handoffMode,
    locationsText,
    policiesText,
    productsText: productsBlock,
    socialText: socialBlock,
  });

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }

  const patch: Record<string, unknown> = {
    business_name: businessName,
    services_offered: servicesOffered,
    services_catalog: servicesCatalog,
    product_catalog: productCatalog,
    social_handles: socialHandles,
    business_hours: businessHours,
    hours_schedule: scheduleForSave,
    after_hours_mode: afterHoursMode,
    agent_name: agentName,
    agent_tone: agentTone,
    team_directory: teamDirectory,
    faqs,
    unknown_answer_fallback: unknownAnswerFallback || null,
    agent_tools: agentTools,
    vertical,
    handoff_mode: handoffMode,
    soniox_voice_id: sonioxVoiceId,
    soniox_voice_label: sonioxVoiceLabel,
    business_locations: businessLocations,
    business_policies: businessPolicies,
    tts_lexicon: ttsLexicon,
    llm_system_prompt: prompt,
  };

  const { error } = await workspace.client.from("tenants").update(patch).eq("id", tenant.id);

  if (error) {
    return ownerSaveFailed("settings.save", error.message);
  }

  await getAuthUser();

  revalidatePath("/settings");

  return { ok: true, source };
}
