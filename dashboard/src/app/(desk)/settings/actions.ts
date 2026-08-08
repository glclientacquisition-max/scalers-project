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
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

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
  const servicesNotes = String(formData.get("services_notes") || "").trim();
  const servicesCatalog = parseServicesCatalogField(formData.get("services_catalog"));
  const servicesOffered =
    formatServicesForCompiler(servicesCatalog, servicesNotes) ||
    String(formData.get("services_offered") || "").trim();
  const agentName =
    String(formData.get("agent_name") || "").trim() || "Receptionist";
  const agentTone = parseAgentTone(String(formData.get("agent_tone") || ""));
  const unknownAnswerFallback = String(
    formData.get("unknown_answer_fallback") || ""
  ).trim();
  const teamDirectory = parseTeamDirectoryField(formData.get("team_directory"));
  const faqs = parseFaqsField(formData.get("faqs"));

  const hoursSchedule = parseHoursSchedule(formData.get("hours_schedule"));
  const locationNotes = String(formData.get("location_notes") || "").trim();
  const afterHoursMode = parseAfterHoursMode(formData.get("after_hours_mode"));
  const escalationEnabledRaw = String(formData.get("escalation_enabled") || "")
    .trim()
    .toLowerCase();
  const escalationEnabled =
    escalationEnabledRaw === "1" ||
    escalationEnabledRaw === "true" ||
    escalationEnabledRaw === "on" ||
    escalationEnabledRaw === "yes";
  const scheduleForSave = hoursSchedule
    ? { ...hoursSchedule, location: locationNotes || hoursSchedule.location }
    : null;
  const businessHours =
    formatHoursForCompiler(scheduleForSave) ||
    String(formData.get("business_hours") || "").trim();

  if (!businessName) {
    return { error: "Business name is required." };
  }
  if (agentName.length > 40) {
    return { error: "Agent name should be under 40 characters." };
  }
  if (!servicesCatalog.length && servicesOffered.length < 12) {
    return { error: "Add at least one service with a name, or extra service notes." };
  }
  if (servicesCatalog.length > 40) {
    return { error: "Services catalog is limited to 40 items." };
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
  });

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }

  const patch: Record<string, unknown> = {
    business_name: businessName,
    whatsapp_notification_number: notificationPhone || tenant.whatsapp_notification_number,
    services_offered: servicesOffered,
    services_catalog: servicesCatalog,
    business_hours: businessHours,
    hours_schedule: scheduleForSave,
    after_hours_mode: afterHoursMode,
    escalation_enabled: escalationEnabled,
    agent_name: agentName,
    agent_tone: agentTone,
    team_directory: teamDirectory,
    faqs,
    unknown_answer_fallback: unknownAnswerFallback || null,
    llm_system_prompt: prompt,
  };

  const { error } = await workspace.client.from("tenants").update(patch).eq("id", tenant.id);

  if (error) {
    if (/escalation_enabled/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/escalation_enabled.sql in Supabase.`,
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
