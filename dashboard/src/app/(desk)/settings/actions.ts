"use server";

import { getAuthUser, isAuthenticated } from "@/lib/auth";
import { parseAgentTone, compileReceptionistPrompt } from "@/lib/promptCompiler";
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
  const servicesOffered = String(formData.get("services_offered") || "").trim();
  const businessHours = String(formData.get("business_hours") || "").trim();
  const agentTone = parseAgentTone(String(formData.get("agent_tone") || ""));
  const unknownAnswerFallback = String(
    formData.get("unknown_answer_fallback") || ""
  ).trim();

  if (!businessName) {
    return { error: "Business name is required." };
  }
  if (servicesOffered.length < 12) {
    return { error: "Describe your services and pricing (a few sentences)." };
  }
  if (businessHours.length < 8) {
    return { error: "Add business hours and where you operate." };
  }
  if (!agentTone) {
    return { error: "Pick a tone of voice." };
  }

  const { prompt, source } = await compileReceptionistPrompt({
    businessName,
    servicesOffered,
    businessHours,
    agentTone,
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
    business_hours: businessHours,
    agent_tone: agentTone,
    unknown_answer_fallback: unknownAnswerFallback || null,
    llm_system_prompt: prompt,
  };

  const { error } = await workspace.client.from("tenants").update(patch).eq("id", tenant.id);

  if (error) {
    if (/unknown_answer_fallback/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/employee_training.sql in Supabase.`,
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

  // Touch auth path so layout revalidation sees fresh tenant on next nav.
  await getAuthUser();

  return { ok: true, source };
}
