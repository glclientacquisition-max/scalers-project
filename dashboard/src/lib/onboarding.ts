import { defaultTenantLlmPrompt } from "@/lib/prompts";

export type OnboardingTone = "professional" | "friendly" | "localized";

export type OnboardingAnswers = {
  servicesPricing: string;
  hoursLocation: string;
  tone: OnboardingTone;
};

/** True when the tenant still has a blank or signup-default receptionist prompt. */
export function tenantNeedsOnboarding(tenant: {
  business_name: string;
  llm_system_prompt: string | null | undefined;
  services_offered?: string | null;
  business_hours?: string | null;
  agent_tone?: string | null;
}): boolean {
  // Structured profile from onboarding/settings means setup is done.
  const hasProfile =
    Boolean(String(tenant.services_offered || "").trim()) &&
    Boolean(String(tenant.business_hours || "").trim()) &&
    Boolean(String(tenant.agent_tone || "").trim());
  if (hasProfile) return false;

  const prompt = String(tenant.llm_system_prompt || "").trim();
  if (!prompt) return true;

  // Signup / SQL default template markers.
  if (prompt.includes("describe what you offer")) return true;
  if (prompt.includes("update this in Sauti Desk")) return true;

  const businessName = String(tenant.business_name || "").trim();
  if (businessName && prompt === defaultTenantLlmPrompt(businessName)) return true;

  // Already has a compiled/custom prompt (e.g. pre-profile tenants) — skip wizard.
  return false;
}

export const TONE_LABELS: Record<OnboardingTone, string> = {
  professional: "Professional",
  friendly: "Friendly",
  localized: "Localized / Sheng",
};

/** Deterministic fallback if Gemini is unavailable. */
export function compilePromptLocally(
  businessName: string,
  answers: OnboardingAnswers
): string {
  const name = businessName.trim() || "the business";
  const toneLine =
    answers.tone === "professional"
      ? "Tone: calm, clear, and professional — warm but concise."
      : answers.tone === "friendly"
        ? "Tone: warm and approachable, like a helpful Kenyan receptionist."
        : "Tone: natural Kenyan receptionist — light Sheng is fine when the caller uses it; stay clear and respectful.";

  return `You are the live phone receptionist for ${name} in Kenya.

BUSINESS KNOWLEDGE:
- Business name: ${name}
- Services & pricing:
${answers.servicesPricing.trim()}
- Hours & location:
${answers.hoursLocation.trim()}
- Languages: English, Kiswahili, and Sheng (automatic — match the caller)
- ${toneLine}

Your job on this call:
1. Answer using ONLY the business knowledge above. If unknown, say the team will follow up.
2. Get the caller's name.
3. Get a short reason for their call.
4. Confirm name + reason, say the business will get back to them soon, then goodbye.

Conversation rules (live phone — be conclusive and intelligent):
- Answer the caller's actual question first — do not stall with holding phrases.
- Ask at most ONE clarifying question per turn.
- Automatically match the caller in English, Kiswahili, or light Sheng. If they switch, switch with them.
- Keep every spoken reply to 1–2 short sentences.
- Never invent prices, availability, or guarantees outside the knowledge above.`;
}
