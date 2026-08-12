"use server";

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
  formatServicesForCompiler,
  parseServicesCatalogField,
} from "@/lib/servicesCatalog";
import {
  formatProductsForCompiler,
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

  const businessName = String(formData.get("business_name") || "").trim();
  const notificationPhone = String(
    formData.get("whatsapp_notification_number") || ""
  ).trim();
  const alertEmail = String(formData.get("alert_email") || "")
    .trim()
    .toLowerCase();
  const servicesNotes = String(formData.get("services_notes") || "").trim();
  const servicesCatalog = parseServicesCatalogField(formData.get("services_catalog"));
  const productCatalog = parseProductCatalogField(formData.get("product_catalog"));
  const socialHandles = parseSocialHandlesField(formData.get("social_handles"));
  const servicesBlock = formatServicesForCompiler(servicesCatalog, servicesNotes);
  const productsBlock = formatProductsForCompiler(productCatalog);
  const socialBlock = formatSocialHandlesForCompiler(socialHandles);
  const servicesOffered =
    [servicesBlock, productsBlock, socialBlock ? `Social & web:\n${socialBlock}` : ""]
      .filter(Boolean)
      .join("\n\n") ||
    String(formData.get("services_offered") || "").trim();
  const agentName =
    String(formData.get("agent_name") || "").trim() || "Receptionist";
  const agentTone = parseAgentTone(String(formData.get("agent_tone") || ""));
  const unknownAnswerFallback = String(
    formData.get("unknown_answer_fallback") || ""
  ).trim();
  const teamDirectory = parseTeamDirectoryField(formData.get("team_directory"));
  const faqs = parseFaqsField(formData.get("faqs"));
  const agentTools = parseAgentTools({
    escalate: String(formData.get("tool_escalate") || "") !== "0",
    end_call: String(formData.get("tool_end_call") || "") !== "0",
  });

  const hoursSchedule = parseHoursSchedule(formData.get("hours_schedule"));
  const locationNotes = String(formData.get("location_notes") || "").trim();
  const afterHoursMode = parseAfterHoursMode(formData.get("after_hours_mode"));
  const vertical = parseVertical(formData.get("vertical"));
  const handoffMode = parseHandoffMode(formData.get("handoff_mode"));
  const sonioxVoiceId = await parseSonioxVoiceId(formData.get("soniox_voice_id"));
  const sonioxVoiceLabel = parseSonioxVoiceLabel(formData.get("soniox_voice_label"));
  const businessLocations = parseBusinessLocationsField(
    formData.get("business_locations")
  );
  const businessPolicies = parseBusinessPoliciesField(
    formData.get("business_policies")
  );
  const ttsLexicon = lexiconForStorage(
    parseTtsLexicon(formData.get("tts_lexicon"))
  );
  const scheduleForSave = hoursSchedule
    ? { ...hoursSchedule, location: locationNotes || hoursSchedule.location }
    : null;
  const businessHours =
    formatHoursForCompiler(scheduleForSave) ||
    String(formData.get("business_hours") || "").trim();
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
  if (alertEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alertEmail)) {
    return { error: "Alert email looks invalid." };
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
    whatsapp_notification_number: notificationPhone || tenant.whatsapp_notification_number,
    alert_email: alertEmail || null,
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
    if (/product_catalog|social_handles/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/product_catalog_and_social.sql in Supabase.`,
      };
    }
    if (/vertical|handoff_mode|business_locations|business_policies/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/business_operating_model.sql in Supabase.`,
      };
    }
    if (/alert_email/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/alert_email.sql in Supabase.`,
      };
    }
    if (/unknown_answer_fallback/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/employee_training.sql in Supabase.`,
      };
    }
    if (/services_catalog/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/services_catalog.sql in Supabase.`,
      };
    }
    if (/hours_schedule/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/hours_schedule.sql in Supabase.`,
      };
    }
    if (/after_hours_mode/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/after_hours_mode.sql in Supabase.`,
      };
    }
    if (/agent_tools/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/agent_tools.sql in Supabase.`,
      };
    }
    if (/soniox_voice_id|soniox_voice_label/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/soniox_voice_id.sql in Supabase.`,
      };
    }
    if (/tts_lexicon/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/tts_lexicon.sql in Supabase.`,
      };
    }
    if (/agent_name|team_directory|faqs/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/knowledge_acquisition_phase1.sql in Supabase.`,
      };
    }
    const missingCol = /business_hours|services_offered|agent_tone|column/i.test(
      error.message
    );
    if (missingCol) {
      return {
        error: `${error.message} Apply docs/supabase/tenant_business_profile.sql in Supabase.`,
      };
    }
    if (/row-level security|permission denied|rls/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/owner_rls.sql if needed.`,
      };
    }
    return { error: error.message };
  }

  await getAuthUser();

  return { ok: true, source };
}
