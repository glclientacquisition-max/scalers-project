"use server";

import { redirect } from "next/navigation";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { generateGeminiText } from "@/lib/gemini";
import {
  compilePromptLocally,
  type OnboardingAnswers,
  type OnboardingTone,
  TONE_LABELS,
  tenantNeedsOnboarding,
} from "@/lib/onboarding";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export type OnboardingState = {
  error?: string;
  step?: number;
};

function parseTone(raw: string): OnboardingTone | null {
  if (raw === "professional" || raw === "friendly" || raw === "localized") return raw;
  return null;
}

const COMPILER_SYSTEM = `You write system prompts for a live Kenyan phone AI receptionist (Sauti Desk).

Output ONLY the final system prompt text — no markdown fences, no preamble.

Requirements for the prompt you write:
- Start with: You are the live phone receptionist for <Business Name> in Kenya.
- Include a BUSINESS KNOWLEDGE section with: business name, services & pricing (as given), hours & location (as given), languages (English, Kiswahili, Sheng — match the caller), and tone guidance matching the chosen tone.
- Include a short "Your job on this call" checklist: answer from knowledge only, get name, get reason, confirm, goodbye.
- Include live-phone conversation rules: answer first (no stalling), at most one clarifying question per turn, match EN/SW/Sheng, 1–2 short spoken sentences, never invent prices/availability outside knowledge.
- Keep it tight and phone-ready. Do not invent services, prices, hours, or locations that were not provided.
- Do not include tool markers or ###ENDCALL### — the voice engine appends those.`;

export async function completeOnboardingAction(
  _prev: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const user = await getAuthUser();
  if (!user) {
    if (await isLegacyAuthenticated()) {
      redirect("/calls");
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
  const tone = parseTone(String(formData.get("tone") || ""));

  if (servicesPricing.length < 12) {
    return { error: "Tell us what you offer and how pricing works (a few sentences).", step: 0 };
  }
  if (hoursLocation.length < 8) {
    return { error: "Add business hours and where you operate.", step: 1 };
  }
  if (!tone) {
    return { error: "Pick a tone of voice.", step: 2 };
  }

  const answers: OnboardingAnswers = { servicesPricing, hoursLocation, tone };

  let prompt: string;
  try {
    if (process.env.GEMINI_API_KEY) {
      const userText = [
        `Business name: ${tenant.business_name}`,
        `Tone: ${TONE_LABELS[tone]} (${tone})`,
        "",
        "Services & pricing:",
        servicesPricing,
        "",
        "Business hours & location:",
        hoursLocation,
        "",
        "Write the optimized llm_system_prompt now.",
      ].join("\n");

      prompt = await generateGeminiText({
        systemInstruction: COMPILER_SYSTEM,
        userText,
        temperature: 0.35,
        maxOutputTokens: 2048,
      });

      // Strip accidental fences if the model ignores instructions.
      prompt = prompt
        .replace(/^```(?:text|markdown)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
    } else {
      prompt = compilePromptLocally(tenant.business_name, answers);
    }
  } catch (err) {
    console.warn(
      "[onboarding] Gemini compile failed, using local template:",
      err instanceof Error ? err.message : err
    );
    prompt = compilePromptLocally(tenant.business_name, answers);
  }

  if (!prompt || prompt.length < 80) {
    return { error: "Could not build a receptionist prompt. Try again.", step: 2 };
  }

  // Guard: compiled prompt must not look like the signup default.
  if (tenantNeedsOnboarding({ business_name: tenant.business_name, llm_system_prompt: prompt })) {
    // Ensure we leave the default-marker path even if Gemini echoed placeholders.
    prompt = compilePromptLocally(tenant.business_name, answers);
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }

  const { error } = await workspace.client
    .from("tenants")
    .update({ llm_system_prompt: prompt })
    .eq("id", tenant.id);

  if (error) {
    return {
      error: /row-level security|permission denied|rls/i.test(error.message)
        ? `${error.message} Apply docs/supabase/owner_rls.sql if needed.`
        : error.message,
      step: 2,
    };
  }

  redirect("/calls");
}
