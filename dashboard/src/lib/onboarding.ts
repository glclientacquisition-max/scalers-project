import { defaultTenantLlmPrompt } from "@/lib/prompts";

export type OnboardingTone =
  | "professional"
  | "friendly"
  | "empathetic"
  | "localized";

export type OnboardingAnswers = {
  servicesPricing: string;
  hoursLocation: string;
  tone: OnboardingTone;
};

export type TeamMember = {
  name: string;
  role: string;
  phone: string;
  email?: string;
};

export type FaqItem = {
  question: string;
  answer: string;
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
  if (
    prompt.includes("update this in Sauti Desk") ||
    prompt.includes("update this in Scalers")
  ) {
    return true;
  }

  const businessName = String(tenant.business_name || "").trim();
  if (businessName && prompt === defaultTenantLlmPrompt(businessName)) return true;

  // Already has a compiled/custom prompt (e.g. pre-profile tenants) — skip wizard.
  return false;
}

export const TONE_LABELS: Record<OnboardingTone, string> = {
  professional: "Professional",
  friendly: "Friendly",
  empathetic: "Empathetic",
  localized: "Localized / Sheng",
};

function toneGuidance(tone: OnboardingTone): string {
  switch (tone) {
    case "professional":
      return "Tone: calm, clear, and professional. Warm but concise.";
    case "friendly":
      return "Tone: warm and approachable, like a helpful Kenyan receptionist.";
    case "empathetic":
      return "Tone: empathetic and steady. Acknowledge frustration first, then help. Skip cheerful filler when the caller is upset.";
    case "localized":
      return "Tone: natural Kenyan receptionist. Light Sheng is fine when the caller uses it; stay clear and respectful.";
  }
}

function formatTeamDirectory(members: TeamMember[]): string {
  const rows = members
    .map((m) => {
      const name = m.name.trim();
      const role = m.role.trim();
      const phone = m.phone.trim();
      const email = (m.email || "").trim();
      if (!name && !role && !phone && !email) return "";
      const bits = [
        role ? `(${role})` : "",
        phone ? `phone ${phone}` : "",
        email ? `email ${email}` : "",
      ].filter(Boolean);
      return `- ${name || "Team member"}${bits.length ? `; ${bits.join("; ")}` : ""}`;
    })
    .filter(Boolean);
  return rows.length ? rows.join("\n") : "(none listed)";
}

function formatFaqs(faqs: FaqItem[]): string {
  const rows = faqs
    .map((f) => {
      const q = f.question.trim();
      const a = f.answer.trim();
      if (!q || !a) return "";
      return `Q: ${q}\nA: ${a}`;
    })
    .filter(Boolean);
  return rows.length ? rows.join("\n\n") : "(none listed)";
}

export type CompileExtras = {
  agentName?: string;
  teamDirectory?: TeamMember[];
  faqs?: FaqItem[];
  unknownAnswerFallback?: string;
  /** When false, compiled prompt must not instruct the escalate tool. */
  escalateEnabled?: boolean;
};

/** Deterministic fallback if Gemini is unavailable. */
export function compilePromptLocally(
  businessName: string,
  answers: OnboardingAnswers,
  extras: CompileExtras | string = {}
): string {
  // Back-compat: older callers passed unknown fallback as a third string.
  const opts: CompileExtras =
    typeof extras === "string" ? { unknownAnswerFallback: extras } : extras;

  const name = businessName.trim() || "the business";
  const agentName = (opts.agentName || "Receptionist").trim() || "Receptionist";
  const unknownLine = (opts.unknownAnswerFallback || "").trim();
  const team = opts.teamDirectory || [];
  const faqs = opts.faqs || [];
  const escalateEnabled = opts.escalateEnabled !== false;
  const teamBlock = formatTeamDirectory(team);
  const faqBlock = formatFaqs(faqs);
  const teamSection = escalateEnabled
    ? `TEAM DIRECTORY (escalation — you are the receptionist, not the expert):
${teamBlock}
- If a caller is angry, asks for a refund, billing help, or a named role above, acknowledge the issue, say the right teammate will follow up (WhatsApp/call), capture name + reason, and escalate to that teammate. Do not invent transfers you cannot perform.`
    : `TEAM DIRECTORY (escalate tool is OFF — awareness only):
${teamBlock}
- Do not escalate. If a caller is angry or asks for someone, acknowledge, capture name + reason, and say the business will follow up.`;

  return `You are ${agentName}, the live phone receptionist for ${name} in Kenya.

IDENTITY:
- Your name is ${agentName}. Introduce yourself naturally on the first turn (e.g. "Hello, you've reached ${name}, this is ${agentName} speaking.").
- ${toneGuidance(answers.tone)}
- Listen to the caller's mood. If they sound frustrated or angry, drop cheerful filler immediately and stay empathetic and concise.

BUSINESS KNOWLEDGE:
- Business name: ${name}
- Services & pricing:
${answers.servicesPricing.trim()}
- Hours & location:
${answers.hoursLocation.trim()}
- Languages: English, Kiswahili, and Sheng (automatic — match the caller)

GOLDEN FAQs (authoritative — answer these exactly when asked):
${faqBlock}

${teamSection}

Your job on this call:
1. Answer using ONLY the business knowledge and golden FAQs above.
2. UNKNOWN ANSWERS: If the ask is outside that knowledge, admit you do not have the detail.${
    unknownLine
      ? ` Prefer saying: "${unknownLine}" (adapt to the caller's language, keep the same meaning).`
      : ` Use a short line like "I don't have that detail — I'll note it and the team will follow up" (or Kiswahili/Sheng equivalent).`
  } Then capture or confirm name + reason. Never invent prices, availability, guarantees, or services.
3. Get the caller's name. If unsure you heard it clearly, confirm once ("Sorry — was that …?") or ask them to spell it.
4. Get a short reason for their call.
5. Confirm name + reason, say the business will get back to them soon, then goodbye.
6. If the caller corrects their name or reason, use the corrected value for the rest of the call.

Conversation rules (live phone — be conclusive and intelligent):
- Answer the caller's actual question first — do not stall with holding phrases.
- Never end a turn on a closed/status fact alone — say how you can still help and ask one next question.
- Ask at most ONE clarifying question per turn.
- Automatically match the caller in English, Kiswahili, or light Sheng. If they switch, switch with them.
- Keep every spoken reply to 1–2 short sentences.
- Never invent prices, availability, team members, or guarantees outside the knowledge above.`;
}
