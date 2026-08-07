import { generateGeminiText } from "@/lib/gemini";
import {
  compilePromptLocally,
  type OnboardingAnswers,
  type OnboardingTone,
  TONE_LABELS,
} from "@/lib/onboarding";

/** Master instruction template for Gemini → voice-engine system prompt. */
export const PROMPT_COMPILER_SYSTEM = `You write system prompts for a live Kenyan phone AI receptionist (Sauti Desk).

Output ONLY the final system prompt text — no markdown fences, no preamble.

Requirements for the prompt you write:
- Start with: You are the live phone receptionist for <Business Name> in Kenya.
- Include a BUSINESS KNOWLEDGE section with: business name, services & pricing (as given), hours & location (as given), languages (English, Kiswahili, Sheng — match the caller), and tone guidance matching the chosen tone.
- Include a short "Your job on this call" checklist: answer from knowledge only, get name, get reason, confirm, goodbye.
- Include live-phone conversation rules: answer first (no stalling), at most one clarifying question per turn, match EN/SW/Sheng, 1–2 short spoken sentences, never invent prices/availability outside knowledge.
- Keep it tight and phone-ready. Do not invent services, prices, hours, or locations that were not provided.
- Do not include tool markers or ###ENDCALL### — the voice engine appends those.`;

export function parseAgentTone(raw: string): OnboardingTone | null {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "professional" || v === "friendly" || v === "localized") return v;
  return null;
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/**
 * Compile structured business fields into llm_system_prompt.
 * Uses Gemini when GEMINI_API_KEY is set; otherwise a local template.
 */
export async function compileReceptionistPrompt(opts: {
  businessName: string;
  servicesOffered: string;
  businessHours: string;
  agentTone: OnboardingTone;
}): Promise<{ prompt: string; source: "gemini" | "local" }> {
  const answers: OnboardingAnswers = {
    servicesPricing: opts.servicesOffered.trim(),
    hoursLocation: opts.businessHours.trim(),
    tone: opts.agentTone,
  };

  if (!process.env.GEMINI_API_KEY) {
    return {
      prompt: compilePromptLocally(opts.businessName, answers),
      source: "local",
    };
  }

  try {
    const userText = [
      `Business name: ${opts.businessName}`,
      `Tone: ${TONE_LABELS[opts.agentTone]} (${opts.agentTone})`,
      "",
      "Services & pricing:",
      answers.servicesPricing,
      "",
      "Business hours & location:",
      answers.hoursLocation,
      "",
      "Write the optimized llm_system_prompt now.",
    ].join("\n");

    const raw = await generateGeminiText({
      systemInstruction: PROMPT_COMPILER_SYSTEM,
      userText,
      temperature: 0.35,
      maxOutputTokens: 2048,
    });
    const prompt = stripFences(raw);
    if (prompt.length < 80) {
      return {
        prompt: compilePromptLocally(opts.businessName, answers),
        source: "local",
      };
    }
    return { prompt, source: "gemini" };
  } catch (err) {
    console.warn(
      "[promptCompiler] Gemini failed, using local template:",
      err instanceof Error ? err.message : err
    );
    return {
      prompt: compilePromptLocally(opts.businessName, answers),
      source: "local",
    };
  }
}
