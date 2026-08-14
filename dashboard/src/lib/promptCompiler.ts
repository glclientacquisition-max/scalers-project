import { generateGeminiText } from "@/lib/gemini";
import {
  compilePromptLocally,
  type FaqItem,
  type OnboardingAnswers,
  type OnboardingTone,
  type TeamMember,
  TONE_LABELS,
} from "@/lib/onboarding";

/** Master instruction template for Gemini → voice-engine system prompt. */
export const PROMPT_COMPILER_SYSTEM = `You write system prompts for a live Kenyan phone AI receptionist (Scalers).

Output ONLY the final system prompt text — no markdown fences, no preamble.

Requirements for the prompt you write:
- Start with: You are <Agent Name>, the live phone receptionist for <Business Name> in Kenya.
- Include an IDENTITY section with: agent name, how to introduce on the first turn ("Hello, you've reached <Business>, this is <Agent> speaking."), tone guidance matching the chosen tone, and a mood rule (if the caller is frustrated or angry, drop cheerful filler and stay empathetic and concise).
- Include a BUSINESS KNOWLEDGE section with: business name, vertical (if given), services & pricing (as given), hours (as given), locations/landmarks/directions (as given), policies (as given), languages (English, Kiswahili, Sheng — match the caller).
- If vertical is retail, add a short RETAIL JOB section: fully assist hours, directions, product/price/stock from the PRODUCT CATALOGUE (not from services), holds/pickups (log create_service_request after name+item+when), policies, and social handles when asked; never invent stock/prices; prefer resolving over callback.
- If vertical is home_services, add a short HOME SERVICES JOB section: fully assist hours, coverage/service area, service/price bands from SERVICES, book visits (create_appointment after service+name+when+landmark), reschedule/cancel via update_appointment, emergencies via escalate; never invent prices/ETAs; prefer resolving over callback.
- Keep SERVICES (delivery, sourcing, etc.) separate from PRODUCT CATALOGUE (individual titles/SKU rows).
- If social/web handles are provided, include them so the receptionist can share Instagram/WhatsApp/website when asked.
- If golden FAQs are provided, include a GOLDEN FAQs section. Treat each Q/A as authoritative. The receptionist must answer those questions from the given answers and must not invent alternatives.
- If a team directory is provided AND escalation is enabled, include a TEAM DIRECTORY / ESCALATION section listing each person as Name, Role, Phone. Escalation is a last useful step: use it when the caller explicitly asks for a human, policy requires one, authority is missing, a tool fails, or repair repeatedly fails. Anger alone is not enough when the issue can be resolved.
- Handoff mode is a preference, not proof that transfer works. Never promise or claim a live transfer; runtime authority decides actual capability.
- If escalation is disabled, list the team for awareness but instruct the receptionist to resolve what it can and offer a saved request only when useful.
- Include a short "Your job on this call" checklist: identify the caller goal; fully assist from knowledge first; collect only details required for an action; confirm the outcome; close. Do not force name capture or callback after a fully resolved question.
- Include live-phone conversation rules: answer first (no stalling), at most one useful clarification per turn, match EN/SW/Sheng, use the minimum speech needed, and never invent prices/stock/availability/people/policies.
- Always include an UNKNOWN ANSWER rule: admit the missing detail, then offer only an authorized next step. Unknown is valid; do not force a callback or promise follow-up.
- If an "unknown request line" is provided, treat it as preferred wording only. Remove callback timing, guarantees, transfers, bookings, stock, or action promises that runtime authority does not support.
- For actions, the prompt must say a tool marker only requests an action. It must never claim an action is saved, held, booked, sent, transferred, or confirmed; backend result confirmation is separate.
- Keep it tight and phone-ready. Do not invent services, prices, hours, locations, FAQs, or teammates that were not provided.
- Do not include tool markers or ###ENDCALL### — the voice engine appends those.`;

export function parseAgentTone(raw: string): OnboardingTone | null {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (
    v === "professional" ||
    v === "friendly" ||
    v === "empathetic" ||
    v === "localized"
  ) {
    return v;
  }
  return null;
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function compiledPromptLooksSafe(
  prompt: string,
  businessName: string
): boolean {
  const text = String(prompt || "").trim();
  const businessToken = String(businessName || "")
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase();
  if (text.length < 80) return false;
  if (!/receptionist/i.test(text)) return false;
  if (!/never invent|do not invent/i.test(text)) return false;
  if (businessToken && !text.toLowerCase().includes(businessToken)) return false;
  if (/###TOOL###|###ENDCALL###/i.test(text)) return false;
  if (
    /\b(always|must)\s+(promise|guarantee)\b|will call (you )?back (today|shortly)|claim (a )?live transfer/i.test(
      text
    )
  ) {
    return false;
  }
  return true;
}

function formatTeamForCompiler(members: TeamMember[]): string {
  if (!members.length) return "(none)";
  return members
    .map((m, i) => {
      const name = m.name.trim() || "Team member";
      const role = m.role.trim() || "General";
      const phone = m.phone.trim() || "n/a";
      const email = (m.email || "").trim();
      const emailPart = email ? ` | Email: ${email}` : "";
      return `${i + 1}. Name: ${name} | Role: ${role} | Phone: ${phone}${emailPart}`;
    })
    .join("\n");
}

function formatFaqsForCompiler(faqs: FaqItem[]): string {
  if (!faqs.length) return "(none)";
  return faqs
    .map((f, i) => `${i + 1}. Q: ${f.question.trim()}\n   A: ${f.answer.trim()}`)
    .join("\n");
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
  agentName?: string;
  teamDirectory?: TeamMember[];
  faqs?: FaqItem[];
  /** Owner-written line for requests outside the business knowledge. */
  unknownAnswerFallback?: string;
  /** Default true. When false, prompt must not instruct escalate tool use. */
  escalateEnabled?: boolean;
  vertical?: string;
  handoffMode?: string;
  locationsText?: string;
  policiesText?: string;
  productsText?: string;
  socialText?: string;
}): Promise<{ prompt: string; source: "gemini" | "local" }> {
  const answers: OnboardingAnswers = {
    servicesPricing: opts.servicesOffered.trim(),
    hoursLocation: opts.businessHours.trim(),
    tone: opts.agentTone,
  };
  const agentName = (opts.agentName || "Receptionist").trim() || "Receptionist";
  const unknownLine = (opts.unknownAnswerFallback || "").trim();
  const teamDirectory = opts.teamDirectory || [];
  const faqs = opts.faqs || [];
  const escalateEnabled = opts.escalateEnabled !== false;
  const vertical = String(opts.vertical || "general").trim() || "general";
  const handoffMode = String(opts.handoffMode || "callback").trim() || "callback";
  const locationsText = String(opts.locationsText || "").trim();
  const policiesText = String(opts.policiesText || "").trim();
  const productsText = String(opts.productsText || "").trim();
  const socialText = String(opts.socialText || "").trim();
  const extras = {
    agentName,
    teamDirectory,
    faqs,
    unknownAnswerFallback: unknownLine,
    escalateEnabled,
    vertical,
    handoffMode,
    locationsText,
    policiesText,
    productsText,
    socialText,
  };

  if (!process.env.GEMINI_API_KEY) {
    return {
      prompt: compilePromptLocally(opts.businessName, answers, extras),
      source: "local",
    };
  }

  try {
    const userText = [
      `Business name: ${opts.businessName}`,
      `Agent name: ${agentName}`,
      `Tone: ${TONE_LABELS[opts.agentTone]} (${opts.agentTone})`,
      `Vertical: ${vertical}`,
      `Handoff mode: ${handoffMode}`,
      "",
      "Services & pricing:",
      answers.servicesPricing,
      "",
      "Product catalogue (individual items — separate from services):",
      productsText || "(none listed)",
      "",
      "Social & web handles:",
      socialText || "(none listed)",
      "",
      "Business hours:",
      answers.hoursLocation,
      "",
      "Locations / landmarks / directions:",
      locationsText || "(none listed)",
      "",
      "Policies:",
      policiesText || "(none listed)",
      "",
      "Team directory (Name | Role | Phone):",
      formatTeamForCompiler(teamDirectory),
      `Escalation tool: ${escalateEnabled ? "ENABLED" : "DISABLED — do not instruct escalate"}`,
      "",
      "Golden FAQs:",
      formatFaqsForCompiler(faqs),
      "",
      unknownLine
        ? `Unknown request line (preferred phrasing when asked for something outside knowledge — adapt to caller language): ${unknownLine}`
        : "Unknown request line: (none — briefly admit the missing detail, then offer only an authorized next step)",
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
    if (!compiledPromptLooksSafe(prompt, opts.businessName)) {
      return {
        prompt: compilePromptLocally(opts.businessName, answers, extras),
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
      prompt: compilePromptLocally(opts.businessName, answers, extras),
      source: "local",
    };
  }
}

/** Parse team_directory / faqs JSON from FormData (hidden JSON fields). */
export function parseJsonArrayField<T>(
  raw: FormDataEntryValue | null,
  mapRow: (row: Record<string, unknown>) => T | null
): T[] {
  const text = String(raw || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        return mapRow(row as Record<string, unknown>);
      })
      .filter((x): x is T => Boolean(x));
  } catch {
    return [];
  }
}

export function parseTeamDirectoryField(
  raw: FormDataEntryValue | null
): TeamMember[] {
  return parseJsonArrayField(raw, (row) => {
    const name = String(row.name ?? "").trim();
    const role = String(row.role ?? "").trim();
    const phone = String(row.phone ?? "").trim();
    const email = String(row.email ?? "").trim().toLowerCase();
    if (!name && !role && !phone && !email) return null;
    if (!name) return null;
    return { name, role, phone, ...(email ? { email } : {}) };
  });
}

export function parseFaqsField(raw: FormDataEntryValue | null): FaqItem[] {
  return parseJsonArrayField(raw, (row) => {
    const question = String(row.question ?? "").trim().slice(0, 200);
    const answer = String(row.answer ?? "").trim().slice(0, 400);
    if (!question || !answer) return null;
    return { question, answer };
  });
}
