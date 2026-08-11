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
- If vertical is retail, add a short RETAIL JOB section: fully assist hours, directions, product/price/stock from catalog, holds/pickups (log create_service_request after name+item+when), policies; never invent stock/prices; prefer resolving over callback.
- If golden FAQs are provided, include a GOLDEN FAQs section. Treat each Q/A as authoritative. The receptionist must answer those questions from the given answers and must not invent alternatives.
- If a team directory is provided AND escalation is enabled, include a TEAM DIRECTORY / ESCALATION section listing each person as Name, Role, Phone. Rule: the AI is the receptionist, not the expert. For anger, refunds, billing, or a matching role, acknowledge, say that teammate will follow up, capture name + reason, and use the escalate tool. If the caller asks for a role not on the list (e.g. sales when only CEO is listed), do not invent staff — offer the closest listed person (usually owner/CEO) and still escalate.
- Respect handoff mode: if callback, do not invent live transfers; if live_transfer, prefer connecting a human when asked and fall back to callback notes when transfer is unavailable.
- If escalation is disabled, still list the team for awareness but instruct: do not escalate; capture name + reason and say the business will follow up.
- Include a short "Your job on this call" checklist: answer from knowledge and FAQs only, get name (confirm once if unsure of pronunciation/spelling), get reason, confirm, goodbye. If the caller corrects their name, use the corrected name going forward.
- Include live-phone conversation rules: answer first (no stalling), never end a turn on a closed/status fact alone (always say how you can still help and ask one next question), at most one clarifying question per turn, match EN/SW/Sheng, 1–2 short spoken sentences, never invent prices/availability/people outside knowledge.
- Always include an UNKNOWN ANSWER rule: when the ask is outside business knowledge and FAQs, admit you do not have that detail, keep one short sentence, then capture or confirm name + reason so the team can follow up. Never invent prices, availability, guarantees, or services.
- If an "unknown request line" is provided, that line is the preferred spoken phrasing (adapt to the caller's language, keep the same meaning). If none is provided, use a short default like "I don't have that detail — I'll note it and the team will follow up" (or Kiswahili/Sheng equivalent).
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
  const extras = {
    agentName,
    teamDirectory,
    faqs,
    unknownAnswerFallback: unknownLine,
    escalateEnabled,
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
        : "Unknown request line: (none — use a short default admit-unknown + team will follow up, then capture name + reason)",
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
