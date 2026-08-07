"use server";

import { redirect } from "next/navigation";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import {
  compilePromptLocally,
  type OnboardingAnswers,
  tenantNeedsOnboarding,
} from "@/lib/onboarding";
import { compileReceptionistPrompt, parseAgentTone } from "@/lib/promptCompiler";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export type OnboardingState = {
  error?: string;
  step?: number;
};

export async function completeOnboardingAction(
  _prev: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const user = await getAuthUser();
  if (!user) {
    if (await isLegacyAuthenticated()) {
      redirect("/admin");
    }
    return { error: "Sign in to finish setup." };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { error: "No workspace linked to this account yet." };
  }

  if (!tenantNeedsOnboarding(tenant)) {
    redirect("/calls");
  }

  const servicesPricing = String(formData.get("services_pricing") || "").trim();
  const hoursLocation = String(formData.get("hours_location") || "").trim();
  const tone = parseAgentTone(String(formData.get("tone") || ""));

  if (servicesPricing.length < 12) {
    return { error: "Tell us what you offer and how pricing works (a few sentences).", step: 0 };
  }
  if (hoursLocation.length < 8) {
    return { error: "Add business hours and where you operate.", step: 1 };
  }
  if (!tone) {
    return { error: "Pick a tone of voice.", step: 2 };
  }

  const answers: OnboardingAnswers = {
    servicesPricing,
    hoursLocation,
    tone,
  };

  let { prompt } = await compileReceptionistPrompt({
    businessName: tenant.business_name,
    servicesOffered: servicesPricing,
    businessHours: hoursLocation,
    agentTone: tone,
  });

  if (!prompt || prompt.length < 80) {
    return { error: "Could not build a receptionist prompt. Try again.", step: 2 };
  }

  // Guard: compiled prompt must not look like the signup default.
  if (tenantNeedsOnboarding({ business_name: tenant.business_name, llm_system_prompt: prompt })) {
    prompt = compilePromptLocally(tenant.business_name, answers);
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }

  const { error } = await workspace.client
    .from("tenants")
    .update({
      services_offered: servicesPricing,
      business_hours: hoursLocation,
      agent_tone: tone,
      llm_system_prompt: prompt,
    })
    .eq("id", tenant.id);

  if (error) {
    const missingCol = /business_hours|services_offered|agent_tone|column/i.test(
      error.message
    );
    if (missingCol) {
      // Columns not applied yet — still save compiled prompt so voice works.
      const { error: promptErr } = await workspace.client
        .from("tenants")
        .update({ llm_system_prompt: prompt })
        .eq("id", tenant.id);
      if (promptErr) {
        return {
          error: `${error.message} Apply docs/supabase/tenant_business_profile.sql in Supabase.`,
          step: 2,
        };
      }
      redirect("/calls");
    }
    return {
      error: /row-level security|permission denied|rls/i.test(error.message)
        ? `${error.message} Apply docs/supabase/owner_rls.sql if needed.`
        : error.message,
      step: 2,
    };
  }

  redirect("/calls");
}
