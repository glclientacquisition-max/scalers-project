"use server";

import { requireMember } from "@/lib/requireMember";

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
import { DEFAULT_AGENT_TONE } from "@/lib/onboarding";
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
import {
  ownerAttestFields,
  ownerConfirmPlan,
  readSavedFactRow,
} from "@/lib/ownerAttestFields";
import { fieldPathsAttestedOnSettingsSave } from "@/lib/fieldPathsFromSettingsSave";
import { cleanFieldPaths } from "@/lib/fieldPathRegistry";
import {
  settingsFieldFromScope,
  settingsScopeValidationError,
} from "@/lib/settingsSaveScope";
import { factHashModeFromEnv, loadCompileProvenance } from "@/lib/tenantFieldProvenance";
import { overlayFieldMeta, planFactConfirm } from "@/lib/factConfirm";
import { normalizeFactRow } from "@/lib/factRowNormalize";
import { assignServiceIds } from "@/lib/serviceIds";

export type SettingsCompileState = {
  error?: string;
  ok?: boolean;
  source?: "gemini" | "local";
};

export async function saveAndCompileSettings(
  _prev: SettingsCompileState,
  formData: FormData
): Promise<SettingsCompileState> {
  await requireMember("settings.edit");
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
  const storedServices = normalizeServicesCatalog(tenant.services_catalog).filter((row) => row.name);
  const pickedServices = pick(
    "servicesCatalog",
    parseServicesCatalogField(formData.get("services_catalog")),
    storedServices
  );
  // Catalogue saves give every service a stable id; other panels keep the stored rows as-is.
  const servicesCatalog = settingsFieldFromScope(scope, "servicesCatalog", true, false)
    ? assignServiceIds(pickedServices, storedServices)
    : pickedServices;
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
  const clipOwnerLine = (raw: string, max: number) =>
    raw.replace(/\s+/g, " ").trim().slice(0, max).trim();

  const spokenName = pick(
    "spokenName",
    clipOwnerLine(String(formData.get("spoken_name") || ""), 40),
    clipOwnerLine(String(tenant.spoken_name || ""), 40)
  );
  const greetingInvite = pick(
    "greetingInvite",
    clipOwnerLine(String(formData.get("greeting_invite") || ""), 80),
    clipOwnerLine(String(tenant.greeting_invite || ""), 80)
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
  const storedHours = parseHoursSchedule(tenant.hours_schedule);
  const ownsLocationLine = settingsFieldFromScope(scope, "locationNotes", true, false);
  const scheduleForSave = hoursSchedule
    ? {
        ...hoursSchedule,
        location: ownsLocationLine
          ? locationNotes
          : String(storedHours?.location || "").trim(),
      }
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

  const scopeError = settingsScopeValidationError(scope, {
    businessName,
    agentName,
    servicesCatalogCount: servicesCatalog.length,
    productCatalogCount: productCatalog.length,
    servicesOfferedLength: servicesOffered.length,
    productCatalogMax: PRODUCT_CATALOG_MAX,
    hasSchedule: Boolean(scheduleForSave),
    businessHoursLength: businessHours.length,
    hasTone: Boolean(agentTone),
    teamCount: teamDirectory.length,
    faqCount: faqs.length,
    submittedVoiceId: String(formData.get("soniox_voice_id") || "").trim(),
    resolvedVoiceId: sonioxVoiceId,
    voiceLabel: String(formData.get("soniox_voice_label") || "").trim(),
  });
  if (scopeError) return { error: scopeError };

  const ownerPathsFromForm = (() => {
    try {
      const parsed = JSON.parse(String(formData.get("owner_field_paths") || "[]"));
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    } catch {
      return [];
    }
  })();

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
    spoken_name: spokenName || null,
    greeting_invite: greetingInvite || null,
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
  };

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }

  // FACT_HASH_MODE: confirm only what changed (plus "Looks right" paths). Both
  // sides go through normalizeFactRow before the diff, so a raw seed or import
  // row never looks changed against its parsed copy. The compile below already
  // sees that pending confirm; the write hashes the stored row as saved.
  const hashMode = factHashModeFromEnv();
  const explicitPaths = cleanFieldPaths(ownerPathsFromForm);
  const storedFactRow: Record<string, unknown> =
    (hashMode ? await readSavedFactRow(workspace.client, tenant.id) : null) ?? { ...tenant };
  const provenance = await loadCompileProvenance(tenant.id);
  const compileFieldMeta = hashMode
    ? overlayFieldMeta(
        provenance.fieldMeta,
        planFactConfirm({
          scope,
          before: storedFactRow,
          after: { ...storedFactRow, ...patch },
          explicitPaths,
          normalize: normalizeFactRow,
        })
      )
    : provenance.fieldMeta;
  const { prompt, source } = await compileReceptionistPrompt({
    businessName,
    servicesOffered,
    businessHours,
    agentTone: agentTone ?? DEFAULT_AGENT_TONE,
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
    productCatalog,
    businessPolicies,
    fieldMeta: compileFieldMeta,
    holdGate: provenance.holdGate,
  });

  patch.llm_system_prompt = prompt;
  const { error } = await workspace.client.from("tenants").update(patch).eq("id", tenant.id);

  if (error) {
    return ownerSaveFailed("settings.save", error.message);
  }

  const socialChannels = socialHandles?.channels;
  const hasSocialHandles =
    Array.isArray(socialChannels) &&
    socialChannels.some((row) => row && String(row.value || "").trim());

  const pathsFromSave = fieldPathsAttestedOnSettingsSave({
    scope,
    businessName,
    vertical,
    spokenName,
    agentName,
    agentTone,
    agentTools,
    hasStructuredHours: Boolean(scheduleForSave),
    businessHoursLength: businessHours.length,
    businessLocationsCount: businessLocations.length,
    businessPolicies,
    productCatalog,
    servicesCatalog,
    faqs,
    hasSocialHandles,
    lineNumber: String(tenant.sautikit_virtual_number || "").trim(),
  });

  if (hashMode) {
    // Hash the stored row as saved. If it cannot be read back, confirm nothing:
    // in hash mode a missing value_hash already reads as "Check this".
    const saved = await readSavedFactRow(workspace.client, tenant.id);
    if (saved) {
      await ownerConfirmPlan(
        tenant.id,
        planFactConfirm({
          scope,
          before: storedFactRow,
          after: saved,
          explicitPaths,
          normalize: normalizeFactRow,
        })
      );
    } else {
      console.warn("[settings.save] saved row unreadable, owner confirm skipped");
    }
  } else {
    const user = await getAuthUser();
    await ownerAttestFields(
      tenant.id,
      cleanFieldPaths([...pathsFromSave, ...ownerPathsFromForm]),
      user?.id ?? null
    );
  }

  revalidatePath("/settings");

  return { ok: true, source };
}
